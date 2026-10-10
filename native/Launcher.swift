import AppKit
final class Launcher: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let label = NSTextField(wrappingLabelWithString: "正在整理本机入口…")
    var child: Process?
    var stopping = false
    var ready = false
    var output = ""
    var address = "http://127.0.0.1:4317"
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:440,height:250), styleMask:[.titled,.closable,.miniaturizable], backing:.buffered, defer:false)
        window.title = "收尾搭子 · 本地测试版"
        let title = NSTextField(labelWithString:"差最后一点？一起收好。")
        title.font = .systemFont(ofSize:24,weight:.semibold)
        title.frame = NSRect(x:28,y:186,width:385,height:36)
        label.frame = NSRect(x:28,y:90,width:384,height:80)
        let open = NSButton(title:"打开收尾台",target:self,action:#selector(openBrowser))
        open.frame = NSRect(x:28,y:28,width:160,height:36)
        let quit = NSButton(title:"退出本机服务",target:self,action:#selector(quitApp))
        quit.frame = NSRect(x:238,y:28,width:170,height:36)
        for view in [title,label,open,quit] { window.contentView!.addSubview(view) }
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
        let menu = NSMenu(), item = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle:"退出收尾搭子",action:#selector(quitApp),keyEquivalent:"q")
        item.submenu=appMenu;menu.addItem(item);NSApp.mainMenu=menu
        start()
    }
    func start() {
        let resources = Bundle.main.resourceURL!
        let process = Process(), pipe = Pipe()
        process.executableURL=resources.appendingPathComponent("bin/node")
        process.arguments=[resources.appendingPathComponent("app/service/lib/main.js").path]
        let inherited=ProcessInfo.processInfo.environment
        var env=["HOME":NSHomeDirectory(),"PATH":resources.appendingPathComponent("bin").path+":/usr/bin:/bin", "LANG":"en_US.UTF-8", "SHOUWEI_WEB_ROOT":resources.appendingPathComponent("web").path, "SHOUWEI_KEYCHAIN_HELPER":resources.appendingPathComponent("bin/keychain").path, "SHOUWEI_RUNTIME_PATCH":resources.appendingPathComponent("runtime/shouwei.patch.yml").path, "SHOUWEI_DISTRIBUTION":"macos-test"]
        // These overrides are for the isolated package verifier; secrets are never inherited.
        for key in ["SHOUWEI_DATA_DIR","SHOUWEI_PORT"] { if let value=inherited[key] { env[key]=value } }
        address="http://127.0.0.1:"+(env["SHOUWEI_PORT"] ?? "4317")
        process.environment=env;process.currentDirectoryURL=resources
        process.standardOutput=pipe;process.standardError=FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler={handle in
            let data=handle.availableData
            guard !data.isEmpty else {handle.readabilityHandler=nil;return}
            DispatchQueue.main.async {
                self.output += String(data:data,encoding:.utf8) ?? ""
                if self.output.contains("收尾搭子已启动：") && !self.ready {
                    self.ready=true;self.label.stringValue="材料留在本机，界面在浏览器打开。\n\(self.address)\n关闭浏览器不会停止服务；请用下方退出按钮。"
                    self.openBrowser()
                }
                if self.output.count>8192 {self.output=""}
            }
        }
        process.terminationHandler={ _ in DispatchQueue.main.async {
            if self.stopping {NSApp.reply(toApplicationShouldTerminate:true)}
            else {self.ready=false;self.label.stringValue="服务未能启动或已经停止。可能已有同一数据目录的服务，或本机端口被占用。请先退出原服务，再重新打开。"}
        }}
        do {try process.run();child=process} catch {label.stringValue="本机运行时未能启动，请检查发行包是否完整。"}
    }
    @objc func openBrowser() {if ready,let url=URL(string:address){NSWorkspace.shared.open(url)}}
    @objc func quitApp() {NSApp.terminate(nil)}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {
        guard let process=child,process.isRunning else{return .terminateNow}
        if !stopping {stopping=true;label.stringValue="正在停止本轮检查与本机服务，请稍等。";process.terminate()}
        return .terminateLater
    }
}
let application=NSApplication.shared
let delegate=Launcher()
application.delegate=delegate
application.setActivationPolicy(.regular)
application.run()
