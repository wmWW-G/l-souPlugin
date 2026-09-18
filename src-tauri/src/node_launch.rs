//! Node 启动路径边界：Windows 原生 API 的 verbatim 路径不直接作为 Node 的入口脚本参数。
use std::{io, path::{Path, PathBuf}, process::Command};

/// 将常规 Windows 磁盘/UNC 绝对路径转换为普通形式。input 为资源目录；返回完整路径。
/// 不截取盘符、不拆分空格。设备路径、相对路径或会改变文件身份的尾随点/空格返回 InvalidInput。
#[cfg(any(windows, test))]
pub fn windows_resource_path(input: &str) -> io::Result<String> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidInput, "不支持的 Windows 资源目录格式");
    let result = if let Some(unc) = input.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(disk) = input.strip_prefix(r"\\?\") {
        let bytes = disk.as_bytes();
        if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || &bytes[1..3] != b":\\" { return Err(invalid()); }
        disk.to_owned()
    } else { input.to_owned() };
    let bytes = result.as_bytes();
    let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && &bytes[1..3] == b":\\";
    let unc = result.starts_with(r"\\") && !result.starts_with(r"\\.\") && !result.starts_with(r"\\?\")
        && result[2..].split('\\').filter(|part| !part.is_empty()).count() >= 2;
    if !drive && !unc { return Err(invalid()); }
    // 普通 Win32 路径可能归一化尾部点/空格；拒绝这些特殊名字，避免运行另一个同名文件。
    if result.contains('\0') || result.contains('/') || result.split('\\').any(|part| part.ends_with('.') || part.ends_with(' ')) {
        return Err(invalid());
    }
    Ok(result)
}

/// 创建尚未启动的 Node 命令；resource 为 Tauri 资源目录，返回命令与实际使用的目录。
/// Windows 转换资源目录后显式设置 cwd，并仅传固定相对脚本路径；Mac 保持原入口与 cwd 行为。
/// 非 Unicode Windows 路径/不支持路径返回 InvalidInput；不使用 shell，不手工拼接命令行或引号。
pub fn backend_command(resource: &Path) -> io::Result<(Command, PathBuf)> {
    #[cfg(windows)]
    {
        let input = resource.to_str().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Windows 资源目录编码不受支持"))?;
        let directory = PathBuf::from(windows_resource_path(input)?);
        let mut command = Command::new(directory.join("runtime").join("node.exe"));
        command.current_dir(&directory).arg(r"payload\desktop\bootstrap.cjs");
        Ok((command, directory))
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new(resource.join("runtime/node"));
        command.arg(resource.join("payload/desktop/bootstrap.cjs"));
        Ok((command, resource.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 中文、空格、括号和深目录必须逐字保留，不能退化成盘符或被拆成多个参数。
    #[test]
    fn preserves_full_drive_path() {
        for ordinary in [r"C:\Users\测试用户\Accio Work (1)\resources\windows-x64".to_owned(), format!("C:\\{}\\resources", "long folder\\".repeat(40))] {
            assert_eq!(windows_resource_path(&format!(r"\\?\{ordinary}")).unwrap(), ordinary);
            assert_eq!(windows_resource_path(&ordinary).unwrap(), ordinary);
        }
    }

    /// UNC 必须保留服务器和共享名，不能把它误改为本地盘符路径。
    #[test]
    fn preserves_unc_share() {
        assert_eq!(windows_resource_path(r"\\?\UNC\server\shared folder\来搜").unwrap(), r"\\server\shared folder\来搜");
        assert_eq!(windows_resource_path(r"\\server\share\app").unwrap(), r"\\server\share\app");
    }

    /// 拒绝会指向设备、当前盘目录或改变目标身份的特殊路径。
    #[test]
    fn rejects_ambiguous_paths() {
        for input in ["C:", r"C:relative", r"relative\app", r"\\.\pipe\name", r"\\?\GLOBALROOT\Device", r"C:\app.\resources", "C:\\app ", r"\\server"] {
            assert!(windows_resource_path(input).is_err(), "{input}");
        }
    }

    /// 在 Windows 上核对实际 Command 的单参数及 cwd；跨编译只证明编译，实机执行另行记录。
    #[cfg(windows)]
    #[test]
    fn windows_command_uses_resource_cwd_and_relative_entry() {
        let (command, _) = backend_command(Path::new(r"\\?\C:\Users\测试用户\Accio Work\resources\windows-x64")).unwrap();
        assert_eq!(command.get_program(), r"C:\Users\测试用户\Accio Work\resources\windows-x64\runtime\node.exe");
        assert_eq!(command.get_current_dir(), Some(Path::new(r"C:\Users\测试用户\Accio Work\resources\windows-x64")));
        assert_eq!(command.get_args().collect::<Vec<_>>(), [std::ffi::OsStr::new(r"payload\desktop\bootstrap.cjs")]);
    }
}
