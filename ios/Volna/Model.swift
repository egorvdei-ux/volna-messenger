import Foundation
import SwiftUI
import Security

struct Person: Codable, Identifiable, Hashable {
    let id: String
    let username: String
    let name: String
}
struct Message: Codable, Identifiable, Hashable {
    let id: Int
    let chat_id: String
    let sender_id: String
    let text: String
    let created_at: Double
    let client_id: String
    var date: Date { Date(timeIntervalSince1970: created_at / 1000) }
}
struct Chat: Codable, Identifiable, Hashable {
    let id: String
    let peer: Person
    let lastMessage: Message?
    let created_at: Double
}
struct Credentials: Codable { let token: String; let user: Person }
struct ServerError: Decodable { let error: String }
struct OK: Decodable { let ok: Bool }
struct VolnaError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum Keychain {
    private static let service = "app.volna.messenger.session"
    static func read() -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "session",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }
    static func write(_ data: Data?) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "session"]
        guard let data else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw VolnaError(message: "Не удалось удалить данные входа: \(status)")
            }
            return
        }
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw VolnaError(message: "Не удалось сохранить вход: \(status)") }
    }
}

@MainActor final class Messenger: ObservableObject {
    @Published var credentials: Credentials?
    @Published var chats: [Chat] = []
    @Published var server: String
    private let session: URLSession
    init() {
        server = UserDefaults.standard.string(forKey: "volna.server") ?? "http://192.168.0.19:8787"
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 12
        config.timeoutIntervalForResource = 20
        session = URLSession(configuration: config)
        if let data = Keychain.read() { credentials = try? JSONDecoder().decode(Credentials.self, from: data) }
    }
    func setServer(_ raw: String) throws {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: value), let host = url.host, ["http", "https"].contains(url.scheme ?? ""),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw VolnaError(message: "Укажите адрес сервера, например http://192.168.0.19:8787")
        }
        let hostParts = host.split(separator: ".", omittingEmptySubsequences: false)
        let parts = hostParts.compactMap { Int($0) }
        let privateIP = hostParts.count == 4 && parts.count == 4 && parts.allSatisfy { (0...255).contains($0) } &&
            (parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && (16...31).contains(parts[1])))
        if url.scheme == "http" && !privateIP && host != "localhost" && host != "127.0.0.1" && !host.hasSuffix(".local") {
            throw VolnaError(message: "Для сервера в интернете нужен адрес https://. HTTP доступен только в локальной сети.")
        }
        if value != server {
            try Keychain.write(nil)
            credentials = nil
            chats = []
            server = value
            UserDefaults.standard.set(value, forKey: "volna.server")
        }
    }
    func request<T: Decodable>(_ path: String, method: String = "GET", body: [String: String]? = nil, authenticated: Bool = true) async throws -> T {
        guard let url = URL(string: server + path) else { throw VolnaError(message: "Проверьте адрес сервера.") }
        let requestToken = credentials?.token
        var request = URLRequest(url: url)
        request.httpMethod = method
        if authenticated, let token = requestToken { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await session.data(for: request) }
        catch {
            if Task.isCancelled { throw CancellationError() }
            throw VolnaError(message: "Нет связи с сервером. Проверьте адрес, Wi-Fi и запущен ли сервер на ПК.")
        }
        guard let response = response as? HTTPURLResponse else { throw VolnaError(message: "Сервер не ответил.") }
        guard (200...299).contains(response.statusCode) else {
            if response.statusCode == 401 && authenticated && credentials?.token == requestToken {
                try? Keychain.write(nil)
                credentials = nil
                chats = []
            }
            throw VolnaError(message: (try? JSONDecoder().decode(ServerError.self, from: data).error) ?? "Ошибка сервера: \(response.statusCode)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    func signIn(username: String, password: String, name: String?) async throws {
        var body = ["username": username, "password": password]
        if let name { body["name"] = name }
        let result: Credentials = try await request(name == nil ? "/api/login" : "/api/register", method: "POST", body: body, authenticated: false)
        try Keychain.write(JSONEncoder().encode(result))
        credentials = result
    }
    func refreshChats() async throws {
        let token = credentials?.token
        let result: [Chat] = try await request("/api/chats")
        if credentials?.token == token { chats = result }
    }
    func startChat(username: String) async throws -> Chat {
        let result: Chat = try await request("/api/chats", method: "POST", body: ["username": username.trimmingCharacters(in: CharacterSet(charactersIn: "@ "))])
        try? await refreshChats()
        return result
    }
    func signOut() async throws {
        // Clear local credentials even if the server is offline. Remote sessions expire after 30 days.
        let _: OK? = try? await request("/api/logout", method: "POST")
        try Keychain.write(nil)
        credentials = nil
        chats = []
    }
}
