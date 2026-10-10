import Foundation
import Security
func reply(_ ok: Bool, _ value: String? = nil) -> Never {
    let result: [String: Any] = ["ok": ok, "value": value as Any? ?? NSNull()]
    if let bytes = try? JSONSerialization.data(withJSONObject: result) { FileHandle.standardOutput.write(bytes) }
    exit(ok ? 0 : 1)
}
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 8192,
      let data = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let action = data["action"] as? String,
      let reference = data["reference"] as? String,
      reference.range(of: "^shouwei-[0-9a-f-]{36}$", options: .regularExpression) != nil,
      Set(data.keys).isSubset(of: ["action", "reference", "value"]) else { reply(false) }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                           kSecAttrService as String: "com.shouwei-buddy.model",
                           kSecAttrAccount as String: reference]
switch action {
case "get":
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    let status = SecItemCopyMatching(search as CFDictionary, &found)
    if status == errSecItemNotFound { reply(true) }
    guard status == errSecSuccess, let bytes = found as? Data, let key = String(data: bytes, encoding: .utf8) else { reply(false) }
    reply(true, key)
case "set":
    guard let value = data["value"] as? String, !value.isEmpty, value.utf8.count <= 4096 else { reply(false) }
    let attributes = [kSecValueData as String: Data(value.utf8)]
    let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updated == errSecSuccess { reply(true) }
    guard updated == errSecItemNotFound else { reply(false) }
    var item = query
    item[kSecValueData as String] = Data(value.utf8)
    reply(SecItemAdd(item as CFDictionary, nil) == errSecSuccess)
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    reply(status == errSecSuccess || status == errSecItemNotFound)
default: reply(false)
}
