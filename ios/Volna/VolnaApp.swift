import SwiftUI

@main struct VolnaApp: App {
    @StateObject private var messenger = Messenger()
    var body: some Scene {
        WindowGroup {
            Group {
                if messenger.credentials != nil { InboxView() }
                else { SignInView() }
            }
            .environmentObject(messenger)
            .tint(.mint)
            .preferredColorScheme(.dark)
        }
    }
}

struct Avatar: View {
    let name: String
    var size: CGFloat = 50
    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .frame(width: size, height: size)
            .foregroundStyle(.mint)
            .background(.mint.opacity(0.12), in: RoundedRectangle(cornerRadius: size * 0.36))
    }
}

struct SignInView: View {
    @EnvironmentObject private var app: Messenger
    @State private var register = true
    @State private var username = ""
    @State private var name = ""
    @State private var password = ""
    @State private var server = ""
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 42)).foregroundStyle(.mint)
                        Text("Волна").font(.system(size: 38, weight: .bold, design: .rounded))
                        Text("Ближе, чем кажется.").font(.title3).foregroundStyle(.secondary)
                    }.padding(.vertical, 18)
                }.listRowBackground(Color.clear)
                Section {
                    Picker("Аккаунт", selection: $register) {
                        Text("Регистрация").tag(true)
                        Text("Вход").tag(false)
                    }.pickerStyle(.segmented)
                    if register { TextField("Ваше имя", text: $name).textContentType(.name) }
                    TextField("Имя пользователя", text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textContentType(.username)
                    SecureField("Пароль — от 8 символов", text: $password)
                        .textContentType(register ? .newPassword : .password)
                } footer: { Text("Имя пользователя: латинские буквы, цифры и _. По нему друзья смогут найти вас.") }
                Section("Сервер") {
                    TextField("http://192.168.0.19:8787", text: $server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("Телефон и ПК должны быть в одной сети Wi-Fi. Сервер на ПК должен работать.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error { Section { Text(error).foregroundStyle(.orange).font(.callout) } }
                Section {
                    Button {
                        busy = true; error = nil
                        Task {
                            defer { busy = false }
                            do {
                                try app.setServer(server)
                                try await app.signIn(username: username, password: password, name: register ? name : nil)
                                password = ""
                            } catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if busy { ProgressView() }
                            else { Text(register ? "Создать аккаунт" : "Войти").fontWeight(.semibold) }
                            Spacer()
                        }.padding(.vertical, 6)
                    }.disabled(busy || username.isEmpty || password.count < 8 || (register && name.trimmingCharacters(in: .whitespaces).isEmpty))
                }
                Section { Text("Первая версия для личных чатов. Без звонков, push-уведомлений и сквозного шифрования. В локальной сети соединение HTTP.").font(.footnote).foregroundStyle(.secondary) }
            }
            .disabled(busy)
            .onAppear { server = app.server }
        }
    }
}

struct InboxView: View {
    @EnvironmentObject private var app: Messenger
    @Environment(\.scenePhase) private var scenePhase
    @State private var newChat = false
    @State private var username = ""
    @State private var error: String?
    @State private var connecting = false
    @State private var showSettings = false
    @State private var path: [Chat] = []
    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "waveform").font(.title2).foregroundStyle(.mint)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("На одной волне").font(.headline)
                            Text("Ваши разговоры начинаются здесь").font(.caption).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 10)
                }.listRowBackground(Color.mint.opacity(0.06))
                if let error { Section { Text(error).font(.callout).foregroundStyle(.orange) } }
                if app.chats.isEmpty {
                    Section {
                        VStack(spacing: 16) {
                            Image(systemName: "paperplane").font(.system(size: 44)).foregroundStyle(.mint)
                            Text("Напишите первым").font(.title2.bold())
                            Text("Попросите друга создать аккаунт и начните чат по его имени пользователя.")
                                .foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Button("Новый чат") { newChat = true }.buttonStyle(.borderedProminent).foregroundStyle(.black)
                        }.frame(maxWidth: .infinity).padding(.vertical, 32)
                    }.listRowBackground(Color.clear)
                } else {
                    Section("Сообщения") {
                        ForEach(app.chats) { chat in
                            NavigationLink(value: chat) {
                                HStack(spacing: 12) {
                                    Avatar(name: chat.peer.name)
                                    VStack(alignment: .leading, spacing: 6) {
                                        HStack {
                                            Text(chat.peer.name).font(.headline).lineLimit(1)
                                            Spacer()
                                            if let last = chat.lastMessage { Text(last.date, style: .time).font(.caption2).foregroundStyle(.secondary) }
                                        }
                                        Text(chat.lastMessage?.text ?? "Начните разговор")
                                            .lineLimit(1).font(.subheadline).foregroundStyle(.secondary)
                                    }
                                }.padding(.vertical, 6)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Волна")
            .navigationDestination(for: Chat.self) { ConversationView(chat: $0) }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { showSettings = true } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("Профиль")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { newChat = true } label: { Image(systemName: "square.and.pencil") }.disabled(connecting).accessibilityLabel("Новый чат")
                }
            }
            .refreshable { await refresh() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    await refresh()
                    do { try await Task.sleep(for: .seconds(4)) } catch { return }
                }
            }
            .alert("Новый чат", isPresented: $newChat) {
                TextField("Имя пользователя", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Начать") {
                    connecting = true
                    Task {
                        defer { connecting = false }
                        do { let chat = try await app.startChat(username: username); path.append(chat); username = ""; error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                }
                Button("Отмена", role: .cancel) {}
            } message: { Text("Введите имя зарегистрированного пользователя.") }
            .sheet(isPresented: $showSettings) { ProfileView() }
        }
    }
    private func refresh() async {
        do { try await app.refreshChats(); error = nil }
        catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var app: Messenger
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                if let user = app.credentials?.user {
                    Section {
                        HStack(spacing: 16) {
                            Avatar(name: user.name, size: 64)
                            VStack(alignment: .leading, spacing: 6) {
                                Text(user.name).font(.title2.bold())
                                Text("@" + user.username).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                        }.padding(.vertical, 12)
                        ShareLink(item: "Найдите меня в мессенджере Волна: @\(user.username)\nСервер: \(app.server)") { Label("Поделиться именем", systemImage: "square.and.arrow.up") }
                    }
                }
                Section("Сервер") { Text(app.server).font(.callout).textSelection(.enabled) }
                Section { Text("Сообщения хранятся на сервере ПК. Чтобы общаться через интернет, разместите сервер с HTTPS. Push-уведомления, звонки и сквозное шифрование в эту версию не входят.").font(.footnote).foregroundStyle(.secondary) }
                if let error { Text(error).foregroundStyle(.orange) }
                Button("Выйти", role: .destructive) {
                    busy = true
                    Task {
                        defer { busy = false }
                        do { try await app.signOut(); dismiss() }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(busy)
            }
            .navigationTitle("Профиль")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
        }.tint(.mint)
    }
}
