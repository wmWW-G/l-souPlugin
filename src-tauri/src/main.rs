#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
use std::{io::{BufRead, BufReader, Write}, process::{Child, Stdio}, sync::{Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::{process::CommandExt, io::AsRawHandle};
use tauri::Manager;
mod native_evidence;
mod node_launch;

/// 写入固定字段的本机原生阶段日志。stage 必须是代码内常量；只记录数值错误码，不写路径、stderr 原文或环境值。
/// 无返回值；磁盘不可写时忽略日志错误，不让诊断机制阻断正常启动。
fn native_log(stage: &'static str, os_code: Option<i32>, exit_code: Option<i32>) {
    let directory = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from).or_else(||
            std::env::var_os("USERPROFILE").map(|home| std::path::PathBuf::from(home).join("AppData/Local")))
    } else {
        std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join("Library/Application Support"))
    };
    let Some(directory) = directory.map(|root| root.join("com.lsou.workbench")) else { return; };
    if std::fs::create_dir_all(&directory).is_err() { return; }
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let Ok(mut file) = options.open(directory.join("native.log")) else { return; };
    let record = serde_json::json!({
        "timestampMs": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
        "nativePid": std::process::id(), "stage": stage, "osCode": os_code, "exitCode": exit_code,
        "parentPid": std::env::var("LSOU_PLUGIN_PARENT_PID").ok().and_then(|value| value.parse::<u32>().ok()),
        "nodeOptionsSet": std::env::var_os("NODE_OPTIONS").is_some(),
        "nodeChannelSet": std::env::var_os("NODE_CHANNEL_FD").is_some(),
    });
    // 一次写入完整 JSON 行；serde_json 的 Display 会分段写，多个诊断线程可能把两行交错。
    let _ = file.write_all(format!("{}\n", record).as_bytes());
}

/// Node 原始错误只映射为固定类别；输入为 stderr 一行，输出静态标签，不返回任何原始内容。
fn classify_node_stderr(line: &str) -> &'static str {
    if line.contains("Cannot find module") || line.contains("MODULE_NOT_FOUND") { "node_module_missing" }
    else if line.contains("SyntaxError") { "node_syntax_error" }
    else if line.contains("NODE_OPTIONS") || line.contains("bad option") { "node_option_error" }
    else { "node_stderr" }
}

/// 后端的就绪/失败事件；就绪 URL 只在进程内导航使用，绝不写入日志或诊断输出。
enum BackendEvent { Ready(tauri::Url), Error(String) }

/// 消费 Node 的 JSON 行协议。reader 为输出管道，emit 接收经过校验的事件；IO/提前退出转成明确失败，返回空。
fn read_backend_output(reader: impl BufRead, mut emit: impl FnMut(BackendEvent)) {
    let mut reported_error = false;
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => {
                emit(BackendEvent::Error("后端输出通道异常，请读取来搜诊断。（NATIVE_BACKEND_IO）".into()));
                return;
            }
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue; };
        if value["type"] == "ready" {
            if let Some(url) = value["url"].as_str().and_then(|value| value.parse::<tauri::Url>().ok()) {
                if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") { emit(BackendEvent::Ready(url)); }
            }
        } else if value["type"] == "error" {
            reported_error = true;
            emit(BackendEvent::Error(value["message"].as_str().unwrap_or("启动失败，请读取来搜诊断。").into()));
        }
    }
    if !reported_error {
        emit(BackendEvent::Error("后端进程输出已结束，请读取来搜诊断中的原生阶段日志。（NATIVE_BACKEND_EOF）".into()));
    }
}

/// 把失败写入启动页并通知 MCP；handle 为应用句柄，message 为已脱敏提示；显示失败仍有 native.log 可读。
fn show_failure(handle: &tauri::AppHandle, message: &str) {
    if message.contains("NATIVE_BACKEND_EOF") { native_log("backend_stdout_closed", None, None); }
    if message.contains("NATIVE_BACKEND_IO") { native_log("backend_stdout_error", None, None); }
    native_log("backend_error", None, None);
    if let Some(window) = handle.get_webview_window("main") {
        let script = format!("document.getElementById('status') && (document.getElementById('status').textContent = {})", serde_json::to_string(message).unwrap());
        let _ = window.eval(&script);
    }
    println!("LSOU_DESKTOP_ERROR");
}

/// 本窗口创建的后端及 Windows Job 句柄；Job 由当前原生进程独占，关闭时清理全部后代。
struct Backend {
    child: Child,
    #[cfg(windows)]
    job: isize,
}

impl Drop for Backend {
    /// 回收本窗口的进程树。无参数或返回值；清理已退出进程时忽略错误。
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe { libc::kill(-(self.child.id() as i32), libc::SIGTERM); }
        #[cfg(windows)]
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.job as _); }
        let _ = self.child.wait();
    }
}

/// 启动随包 Node。resource 为 Tauri 资源目录；返回受生命周期管理的子进程，启动/Job 设置失败时抛 IO 错误。
fn launch_backend(resource: &std::path::Path) -> std::io::Result<Backend> {
    let node = if cfg!(windows) { "runtime/node.exe" } else { "runtime/node" };
    if !resource.join(node).is_file() || !resource.join("payload/desktop/bootstrap.cjs").is_file() {
        native_log("package_missing", None, None);
        return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "随包后端文件缺失"));
    }
    let (mut command, launch_directory) = node_launch::backend_command(resource).map_err(|error| {
        native_evidence::record("spawn_path_rejected", None, "资源目录不能安全转换为 Node 启动路径");
        error
    })?;
    command.env("LSOU_NATIVE_PID", std::process::id().to_string())
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW：用户不会看到额外命令行窗口。
    native_log("node_spawn_begin", None, None);
    native_evidence::record("spawn_configuration", None, &format!(
        "stdin=null; stdout=pipe; stderr=pipe; createNoWindow={}; cwdExists={}; bootstrapExists={}; nodeExists={}; resourceAbsolute={}; resourceVerbatim={}; launchVerbatim={}; relativeEntry={}",
        cfg!(windows), command.get_current_dir().map(|dir| dir.is_dir()).unwrap_or_else(|| std::env::current_dir().map(|dir| dir.is_dir()).unwrap_or(false)),
        launch_directory.join("payload/desktop/bootstrap.cjs").is_file(), launch_directory.join(node).is_file(), resource.is_absolute(),
        resource.as_os_str().to_string_lossy().starts_with(r"\\?\"), launch_directory.as_os_str().to_string_lossy().starts_with(r"\\?\"), cfg!(windows)));
    let mut child = command.spawn().map_err(|error| {
        native_log("node_spawn_failed", error.raw_os_error(), None);
        error
    })?;
    native_log("node_spawned", None, None);
    // 保存有界脱敏正文，同时保留旧阶段事件；只改采集，不改子进程参数、管道或 Job。
    let node_pid = child.id();
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            native_evidence::capture(stderr, |line| native_log(classify_node_stderr(line), None, None), |text, truncated| {
                if !text.is_empty() || truncated {
                    native_evidence::record(if truncated { "node_stderr_truncated" } else { "node_stderr" }, Some(node_pid), &text);
                }
            });
        });
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        // Windows 不支持 Unix 负 PID 进程组；Job 的 KILL_ON_JOB_CLOSE 同时覆盖异常退出和强制终止。
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = !job.is_null() && unsafe {
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as _, std::mem::size_of_val(&limits) as u32) != 0
                && AssignProcessToJobObject(job, child.as_raw_handle() as _) != 0
        };
        if !ok {
            let error = std::io::Error::last_os_error();
            native_log("job_failed", error.raw_os_error(), None);
            if !job.is_null() { unsafe { CloseHandle(job); } }
            let _ = child.kill(); let _ = child.wait();
            return Err(error);
        }
        native_log("job_ready", None, None);
        return Ok(Backend { child, job: job as isize });
    }
    #[cfg(not(windows))]
    Ok(Backend { child })
}

/// 检查插件 MCP 父进程是否仍在。pid 为正整数，返回 bool；不结束或访问其他进程的数据。
fn owner_alive(pid: u32) -> bool {
    #[cfg(unix)]
    { unsafe { libc::kill(pid as i32, 0) == 0 } }
    #[cfg(windows)]
    {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::{OpenProcess, WaitForSingleObject}};
        unsafe {
            let handle = OpenProcess(0x00100000, 0, pid); // SYNCHRONIZE，仅等待退出所需权限。
            if handle.is_null() { return false; }
            let alive = WaitForSingleObject(handle, 0) == 258; // WAIT_TIMEOUT 表示仍在运行。
            CloseHandle(handle);
            alive
        }
    }
}

/// 结束由本窗口创建的后端；child 为共享状态，返回空；通过 Drop 清理对应平台的进程树。
fn stop_backend(child: &Arc<Mutex<Option<Backend>>>) {
    if let Ok(mut slot) = child.lock() { slot.take(); }
}

/// 启动 Tauri 并管理 Node 后端；无参数/返回值，配置错误时退出并报告。
fn main() {
    native_log("native_entry", None, None);
    // GUI 无控制台也能采集 panic；force_capture 无需改用户的 RUST_BACKTRACE 环境变量。
    std::panic::set_hook(Box::new(|info| {
        native_log("native_panic", None, None);
        native_evidence::record("native_panic", None, &format!("{info}\n{}", std::backtrace::Backtrace::force_capture()));
    }));
    let child: Arc<Mutex<Option<Backend>>> = Arc::new(Mutex::new(None));
    let setup_child = child.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .setup(move |app| {
            native_log("tauri_setup_enter", None, None);
            let resource = app.path().resource_dir().map_err(|error| {
                native_log("resource_resolve_failed", None, None);
                error
            })?;
            let mut process = match launch_backend(&resource) {
                Ok(process) => process,
                Err(error) => {
                    show_failure(app.handle(), &format!("无法启动随包后端，请读取来搜诊断中的原生阶段日志。（NATIVE_LAUNCH_FAILED，系统码 {}）", error.raw_os_error().map(|code| code.to_string()).unwrap_or_else(|| "无".into())));
                    return Ok(());
                }
            };
            let stdout = process.child.stdout.take().ok_or("后端输出通道不可用")?;
            *setup_child.lock().map_err(|_| "后端状态锁不可用")? = Some(process);
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                read_backend_output(BufReader::new(stdout), |event| match event {
                    BackendEvent::Ready(url) => {
                        if let Some(window) = handle.get_webview_window("main") {
                            if window.navigate(url).is_ok() {
                                native_log("backend_ready", None, None);
                                println!("LSOU_DESKTOP_READY");
                            } else {
                                native_log("navigate_failed", None, None);
                                show_failure(&handle, "后端已启动，但窗口导航失败，请读取来搜诊断。（NATIVE_NAVIGATE_FAILED）");
                            }
                        }
                    }
                    BackendEvent::Error(message) => show_failure(&handle, &message),
                });
            });
            let watched_child = setup_child.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(250));
                let Ok(mut slot) = watched_child.lock() else { break; };
                let Some(process) = slot.as_mut() else { break; };
                if let Ok(Some(status)) = process.child.try_wait() {
                    native_log("backend_exit", None, status.code());
                    break;
                }
            });
            // 插件 MCP 会话终止时退出窗口，避免卸载或切换空间后残留旧账号服务。
            if let Ok(owner) = std::env::var("LSOU_PLUGIN_PARENT_PID").unwrap_or_default().parse::<u32>() {
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(Duration::from_secs(2));
                    if owner > 1 && !owner_alive(owner) { handle.exit(0); break; }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app { Ok(app) => app, Err(_) => {
        native_log("native_build_failed", None, None);
        stop_backend(&child);
        std::process::exit(1);
    } };
    app.run(move |_, event| { if let tauri::RunEvent::Exit = event {
        native_log("native_exit", None, None);
        stop_backend(&child);
    } });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 模拟 Node 在 ready 之前退出；必须产生失败事件，不能静默保留启动页。
    #[test]
    fn closed_backend_output_reports_failure() {
        let mut events = Vec::new();
        read_backend_output(std::io::Cursor::new(b""), |event| events.push(event));
        assert!(matches!(events.last(), Some(BackendEvent::Error(message)) if message.contains("NATIVE_BACKEND_EOF")));
    }

    /// 只接受本机就绪地址；关闭输出不能把远程 URL 或任意日志判定为成功。
    #[test]
    fn backend_ready_requires_loopback_url() {
        let input = "{\"type\":\"ready\",\"url\":\"https://untrusted.example\"}\n{\"type\":\"ready\",\"url\":\"http://127.0.0.1:1234/?desktopTicket=test\"}\n";
        let mut events = Vec::new();
        read_backend_output(std::io::Cursor::new(input), |event| events.push(event));
        assert_eq!(events.iter().filter(|event| matches!(event, BackendEvent::Ready(_))).count(), 1);
        assert!(matches!(events.last(), Some(BackendEvent::Error(_))));
    }

    /// 原始 stderr 可能含个人路径/环境值；日志只记录固定错误类别。
    #[test]
    fn node_error_classification_drops_private_text() {
        assert_eq!(classify_node_stderr("Error: Cannot find module 'C:\\Users\\private\\token'"), "node_module_missing");
        assert_eq!(classify_node_stderr("SyntaxError: unexpected secret-token"), "node_syntax_error");
        assert_eq!(classify_node_stderr("private-token"), "node_stderr");
    }
}
