import SwiftUI

struct ConversationView: View {
    let chat: Chat
    @EnvironmentObject private var app: Messenger
    @Environment(\.scenePhase) private var scenePhase
    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var sendError: String?
    @State private var sending = false
    @State private var loadingOlder = false
    @State private var hasOlder = true
    @State private var loaded = false
    @State private var pendingText: String?
    @State private var pendingID: String?
    @FocusState private var inputFocused: Bool
    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Circle().fill(error == nil ? Color.mint : Color.orange).frame(width: 6, height: 6)
                Text(error == nil ? "@\(chat.peer.username) · личный чат" : "Соединение прервано")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
            }.padding(.horizontal, 20).padding(.bottom, 12)
            if let error { Text(error).font(.caption).foregroundStyle(.orange).padding(.horizontal).padding(.bottom, 8) }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if hasOlder && loaded && !messages.isEmpty {
                            Button(loadingOlder ? "Загрузка…" : "Ранние сообщения") { Task { await older() } }
                                .font(.caption).disabled(loadingOlder).padding(10)
                        }
                        if loaded && messages.isEmpty {
                            VStack(spacing: 10) {
                                Avatar(name: chat.peer.name, size: 72)
                                Text("Поздоровайтесь с \(chat.peer.name)").font(.headline)
                                Text("Здесь начнётся ваш разговор").font(.subheadline).foregroundStyle(.secondary)
                            }.frame(maxWidth: .infinity).padding(.top, 70)
                        }
                        ForEach(messages) { message in
                            MessageBubble(message: message, mine: message.sender_id == app.credentials?.user.id)
                                .id(message.id)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(.horizontal, 16).padding(.vertical, 14)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: messages.last?.id) { _ in
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: inputFocused) { focused in
                    if focused { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                }
            }
            if let sendError {
                HStack {
                    Text(sendError).font(.caption).foregroundStyle(.orange)
                    Spacer()
                    Button("Повторить") { send() }.font(.caption.bold()).disabled(sending)
                }.padding(.horizontal, 16).padding(.vertical, 8)
            }
            HStack(alignment: .bottom, spacing: 12) {
                TextField("Сообщение", text: $draft, axis: .vertical)
                    .lineLimit(1...6).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22))
                    .focused($inputFocused).disabled(sending)
                Button(action: send) {
                    Group {
                        if sending { ProgressView().tint(.black) }
                        else { Image(systemName: "arrow.up").font(.system(size: 20, weight: .bold)).foregroundStyle(.black) }
                    }.frame(width: 46, height: 46).background(trimmed.isEmpty ? Color.gray : Color.mint, in: Circle())
                }.disabled(sending || trimmed.isEmpty || trimmed.unicodeScalars.count > 4000).accessibilityLabel("Отправить")
            }.padding(.horizontal, 16).padding(.vertical, 10).background(.ultraThinMaterial)
            if trimmed.unicodeScalars.count > 4000 { Text("До 4000 символов в сообщении").font(.caption).foregroundStyle(.orange) }
        }
        .background(Color(red: 0.035, green: 0.055, blue: 0.08))
        .navigationTitle(chat.peer.name).navigationBarTitleDisplayMode(.inline)
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(2)) } catch { return }
            }
        }
    }
    private func merge(_ incoming: [Message]) {
        var indexed = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })
        for message in incoming { indexed[message.id] = message }
        messages = indexed.values.sorted { $0.id < $1.id }
    }
    private func refresh() async {
        do {
            let suffix = loaded ? "?after=\(messages.last?.id ?? 0)" : ""
            let result: [Message] = try await app.request("/api/chats/\(chat.id)/messages\(suffix)")
            if !loaded { hasOlder = result.count == 100 }
            merge(result); loaded = true; error = nil
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
    private func older() async {
        guard let first = messages.first, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let result: [Message] = try await app.request("/api/chats/\(chat.id)/messages?before=\(first.id)")
            hasOlder = result.count == 100
            merge(result)
        } catch { self.error = error.localizedDescription }
    }
    private func send() {
        let text = trimmed
        guard !sending, !text.isEmpty, text.unicodeScalars.count <= 4000 else { return }
        if pendingText != text { pendingText = text; pendingID = UUID().uuidString }
        let id = pendingID ?? UUID().uuidString
        sending = true; sendError = nil
        Task {
            defer { sending = false }
            do {
                let message: Message = try await app.request("/api/chats/\(chat.id)/messages", method: "POST", body: ["text": text, "client_id": id])
                merge([message]); draft = ""; pendingText = nil; pendingID = nil
                error = nil
            } catch { sendError = error.localizedDescription }
        }
    }
}

struct MessageBubble: View {
    let message: Message
    let mine: Bool
    var body: some View {
        HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: .trailing, spacing: 6) {
                Text(message.text).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                HStack(spacing: 4) {
                    Text(message.date, format: .dateTime.day().month(.abbreviated).hour().minute())
                    if mine { Image(systemName: "checkmark").accessibilityLabel("Доставлено на сервер") }
                }.font(.system(size: 10)).opacity(0.6)
            }
            .font(.system(size: 16)).padding(.horizontal, 14).padding(.vertical, 10)
            .foregroundStyle(mine ? Color.black : Color.white)
            .background(mine ? Color.mint : Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
            if !mine { Spacer(minLength: 48) }
        }
    }
}
