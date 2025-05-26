sequenceDiagram
    participant User as 👤 User
    participant UI as 🖼️ UI Components<br/>(TurnView, ThoughtPillView)
    participant VM as 🧠 ChatViewModel<br/>(ConversationVM)
    participant EventQueue as ⚡ EventQueue<br/>(Actor)
    participant WebSocket as 🔌 WebSocketClient<br/>(Socket.IO)
    participant ChatAPI as 🌐 ChatAPI<br/>(HTTP)
    participant Backend as 🖥️ Backend Server

    %% === INITIAL CONNECTION & SESSION ===
    Note over User, Backend: 🚀 Initial Connection & Session Setup
    
    User->>VM: Open chat / Navigate to conversation
    VM->>WebSocket: connect(conversationId?)
    WebSocket->>Backend: Socket.IO connect + auth params
    Backend-->>WebSocket: 'connected' event
    Backend-->>WebSocket: 'new_session_created' event
    WebSocket->>EventQueue: ingest(EmittedMessage: session creation)
    EventQueue->>EventQueue: Convert to DisplayableMessage
    EventQueue-->>VM: threadPublisher (new thread)
    VM-->>UI: Update with session info

    %% === USER SENDS MESSAGE ===
    Note over User, Backend: 💬 User Message Flow (WebSocket)
    
    User->>UI: Type message & send
    UI->>VM: sendMessage(text, cashTags?)
    VM->>VM: Create optimistic DisplayableMessage
    VM->>EventQueue: ingest(optimisticMessage: .optimisticPending)
    EventQueue-->>VM: threadPublisher (immediate UI update)
    VM-->>UI: Show message as "Pending" 