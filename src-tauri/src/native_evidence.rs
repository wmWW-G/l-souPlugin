//! 仅用于本机排障的限量错误证据；不向 MCP/网页自动返回文本，也不记录就绪 URL。
use std::{io::{Read, Write}, path::PathBuf, sync::{Mutex, OnceLock}, time::{SystemTime, UNIX_EPOCH}};

/// 对错误正文脱敏。text 是 stderr/panic 文本，返回保留错误类型与堆栈的字符串；不抛 IO 错误。
/// 先处理完整输入再截断，避免在截断处把凭据保留成未匹配的半个字符串。
pub fn sanitize(text: &str) -> String {
    let mut result = text.to_owned();
    for (key, value) in std::env::vars_os() {
        let (Some(key), Some(value)) = (key.to_str(), value.to_str()) else { continue; };
        let key = key.to_ascii_uppercase();
        if value.len() >= 6 && (key.contains("TOKEN") || key.contains("SECRET") || key.contains("PASSWORD") || key.contains("API_KEY")) {
            result = result.replace(value, "[redacted]");
        }
    }
    static RULES: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let rules = RULES.get_or_init(|| [
        r#"(?i)https?://[^\s\"'<>]+"#,
        r#"(?i)(?:authorization|cookie|token|ticket|password|secret|api[_-]?key)[\w-]*[\"']?\s*[:=]\s*[^\r\n,}]+"#,
        r#"(?i)bearer\s+\S+"#,
        r#"(?i)(?:[a-z]:[\\/]|\\\\)[^\r\n\"'<>|]*"#,
        r#"/(?:Users|home|private|tmp|var)/[^\r\n\"'<>]*"#,
        r#"[A-Za-z0-9_+/=-]{32,}"#,
    ].iter().map(|pattern| regex::Regex::new(pattern).expect("固定脱敏规则必须有效")).collect());
    for rule in rules { result = rule.replace_all(&result, "[redacted]").into_owned(); }
    result.chars().take(16384).collect()
}

/// 返回当前系统的私有日志目录；环境缺失返回 None，不回退到插件安装目录。
fn directory() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from).or_else(||
            std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("AppData/Local")))
    } else {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    }.map(|base| base.join("com.lsou.workbench"))
}

/// 写一个脱敏证据记录；kind 为固定类别，node_pid 为真实子进程号，text 为错误正文。
/// 最多保留当前与上一份各约 512 KiB 日志；所有 IO 失败忽略，不能阻断启动或触发二次 panic。
pub fn record(kind: &str, node_pid: Option<u32>, text: &str) {
    let text = sanitize(text);
    static LOCK: Mutex<()> = Mutex::new(());
    let Ok(_guard) = LOCK.lock() else { return; };
    let Some(directory) = directory() else { return; };
    if std::fs::create_dir_all(&directory).is_err() { return; }
    let file = directory.join("native-evidence.log");
    if std::fs::metadata(&file).map(|info| info.len() > 512 * 1024).unwrap_or(false) {
        let previous = directory.join("native-evidence.previous.log");
        let _ = std::fs::remove_file(&previous);
        if std::fs::rename(&file, previous).is_err() { return; }
    }
    let row = serde_json::json!({"timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        "nativePid": std::process::id(), "nodePid": node_pid, "kind": kind, "text": text});
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    if let Ok(mut file) = options.open(file) { let _ = writeln!(file, "{row}"); }
}

/// 持续排空 stderr，但只保存前 32 KiB；reader 为子进程管道，emit 接收有界正文与是否截断。
/// 固定缓冲避免超长无换行错误撑爆内存；读失败也交付已收集内容，不抛异常。
pub fn capture(mut reader: impl Read, mut observe: impl FnMut(&str), emit: impl FnOnce(String, bool)) {
    let mut buffer = [0u8; 4096];
    let mut retained = Vec::new();
    let mut truncated = false;
    let mut line = Vec::new();
    let mut observed = 0;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => {
                // 保持原阶段事件在收到 stderr 行时写入，不能把全部事件时间移到 EOF。
                for byte in &buffer[..size] {
                    if observed >= 8 { break; }
                    if *byte == b'\n' {
                        observe(&String::from_utf8_lossy(&line));
                        observed += 1;
                        line.clear();
                    } else if line.len() < 4096 { line.push(*byte); }
                }
                let keep = size.min(32768usize.saturating_sub(retained.len()));
                retained.extend_from_slice(&buffer[..keep]);
                truncated |= keep < size;
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => { truncated = true; break; }
        }
    }
    if observed < 8 && !line.is_empty() { observe(&String::from_utf8_lossy(&line)); }
    emit(String::from_utf8_lossy(&retained).into_owned(), truncated);
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 错误类型保留，而 URL、路径、票据和凭据不进入证据。
    #[test]
    fn redacts_sensitive_error_context() {
        let output = sanitize("Error: EINVAL uv_pipe_open\n at C:\\Users\\Alice\\secret\\bootstrap.cjs:8\nhttps://example.com/?desktopTicket=abc\nAuthorization: Bearer private\nsecret=hidden\n/Users/Alice/project\n0123456789abcdef0123456789abcdef");
        assert!(output.contains("EINVAL uv_pipe_open"));
        for private in ["Alice", "example.com", "abc", "private", "hidden", "0123456789abcdef"] { assert!(!output.contains(private), "{output}"); }
    }
    /// 即使输入无换行且大于采集上限，也全部排空并报告截断。
    #[test]
    fn drains_long_stderr_with_bounded_capture() {
        let input = vec![b'x'; 100000];
        let mut cursor = std::io::Cursor::new(input);
        capture(&mut cursor, |_| {}, |text, truncated| { assert_eq!(text.len(), 32768); assert!(truncated); });
        assert_eq!(cursor.position(), 100000);
    }
    /// 分块接收的错误正文须完整重组，供错误首行与后续堆栈关联。
    #[test]
    fn preserves_short_stderr() {
        let mut lines = Vec::new();
        capture(std::io::Cursor::new(b"Error: EINVAL\n at node:internal\n"), |line| lines.push(line.to_owned()), |text, truncated| {
            assert_eq!(text, "Error: EINVAL\n at node:internal\n"); assert!(!truncated);
        });
        assert_eq!(lines, ["Error: EINVAL", " at node:internal"]);
    }
}
