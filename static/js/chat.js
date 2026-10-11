
/* =========================================================
   1. CONFIGURATION
   ========================================================= */

const CONFIG = window.WHATSAPP_CONFIG || {};

const CURRENT_USER_ID = Number(
    CONFIG.currentUserId || document.body.dataset.userId || 0
);

const CURRENT_USERNAME =
    CONFIG.currentUsername || document.body.dataset.username || "";

const RTC_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};


/* =========================================================
   2. GLOBAL STATE
   ========================================================= */

let socket = null;
let socketReconnectTimer = null;
let socketReconnectAttempts = 0;
let isUnloading = false;

let selectedUserId = null;
let selectedContact = null;

let contacts = [];
let contactMap = new Map();

let messageElements = new Map();

let presenceTimer = null;
let isSendingMessage = false;

let currentCallUserId = null;
let currentCallUsername = "";
let peerConnection = null;
let localStream = null;
let incomingOffer = null;
let incomingCallerId = null;
let incomingCallerName = "";
let pendingIceCandidates = [];
let callStarted = false;


/* =========================================================
   3. DOM HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}

function on(element, type, handler) {
    if (element) {
        element.addEventListener(type, handler);
    }
}

function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
}

let elements = {};

const ELEMENT_IDS = [
    "whatsappContainer",
    "addContactBtn", "notificationBtn", "notificationCount",
    "contactSearch", "contactList", "contactLoading",
    "chatArea", "emptyChat", "chatInterface",
    "chatAvatar", "chatUsername", "chatStatus",
    "voiceCallBtn", "chatMenuBtn", "contactMenu", "deleteContactBtn",
    "messageContainer", "messageLoading", "typingIndicator",
    "messageForm", "attachBtn", "mediaInput", "messageInput",
    "sendMessageBtn",
    "addContactModal", "addContactForm", "contactUsernameInput",
    "contactMessage", "addContactSubmitBtn",
    "notificationModal", "notificationList",
    "callModal", "callAvatar", "callUserName", "callStatus", "endCallBtn",
    "incomingCallModal", "incomingCallAvatar", "incomingCallerName",
    "rejectCallBtn", "acceptCallBtn",
    "remoteAudio", "enableAudioBtn", "toastContainer"
];

function cacheElements() {
    elements = {};
    ELEMENT_IDS.forEach(function (id) {
        elements[id] = $(id);
    });
}


/* =========================================================
   4. INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {
    cacheElements();
    initializeApplication();
});

async function initializeApplication() {
    if (!CURRENT_USER_ID) {
        console.error("Current user ID was not found.");
        showToast("User information is missing.", "error");
        return;
    }

    bindEvents();
    connectWebSocket();

    await loadContacts();
    await loadNotifications();
}


/* =========================================================
   5. EVENT BINDINGS
   ========================================================= */

function bindEvents() {

    on(elements.addContactBtn, "click", function () {
        openModal("addContactModal");
        if (elements.contactUsernameInput) {
            elements.contactUsernameInput.focus();
        }
    });

    on(elements.addContactForm, "submit", handleAddContact);

    on(elements.contactSearch, "input", function () {
        renderContacts(elements.contactSearch.value.trim());
    });

    on(elements.messageForm, "submit", handleMessageSubmit);

    on(elements.messageInput, "keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleMessageSubmit(event);
        }
    });

    on(elements.messageInput, "input", autoResizeMessageInput);

    on(elements.attachBtn, "click", function () {
        if (elements.mediaInput) elements.mediaInput.click();
    });

    on(elements.mediaInput, "change", handleMediaUpload);

    on(elements.voiceCallBtn, "click", startVoiceCall);
    on(elements.endCallBtn, "click", endCurrentCall);
    on(elements.acceptCallBtn, "click", acceptIncomingCall);
    on(elements.rejectCallBtn, "click", rejectIncomingCall);

    on(elements.enableAudioBtn, "click", function () {
        if (elements.remoteAudio) {
            elements.remoteAudio.play().then(function () {
                elements.enableAudioBtn.classList.add("hidden");
            }).catch(function (error) {
                console.warn("Audio still blocked:", error);
            });
        }
    });

    on(elements.notificationBtn, "click", async function () {
        openModal("notificationModal");
        await loadNotifications();
    });

    on(elements.chatMenuBtn, "click", function (event) {
        event.stopPropagation();
        if (elements.contactMenu) {
            elements.contactMenu.classList.toggle("hidden");
        }
    });

    on(elements.deleteContactBtn, "click", handleDeleteContact);

    document.querySelectorAll("[data-close-modal]").forEach(function (button) {
        button.addEventListener("click", function () {
            closeModal(button.dataset.closeModal);
        });
    });

    document.querySelectorAll(".modal-overlay").forEach(function (modal) {
        modal.addEventListener("click", function (event) {
            if (event.target === modal) {
                modal.classList.add("hidden");
            }
        });
    });

    document.addEventListener("click", function () {
        if (elements.contactMenu) {
            elements.contactMenu.classList.add("hidden");
        }
    });

    on(elements.contactMenu, "click", function (event) {
        event.stopPropagation();
    });

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                connectWebSocket();
            }
            if (selectedUserId) {
                loadPresence(selectedUserId);
            }
        }
    });

    window.addEventListener("beforeunload", function () {
        isUnloading = true;
        stopPresencePolling();

        if (socket) {
            try {
                socket.close();
            } catch (error) {
                console.warn(error);
            }
        }

        cleanupCall();
    });
}


/* =========================================================
   6. CSRF + API HELPER
   ========================================================= */

function getCSRFToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');

    if (meta && meta.getAttribute("content")) {
        return meta.getAttribute("content");
    }

    const cookies = document.cookie.split(";");

    for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith("csrftoken=")) {
            return decodeURIComponent(cookie.substring("csrftoken=".length));
        }
    }

    return "";
}

async function apiRequest(url, options = {}) {

    const headers = options.headers || {};

    if (options.method && options.method.toUpperCase() !== "GET") {
        headers["X-CSRFToken"] = getCSRFToken();
    }

    headers["X-Requested-With"] = "XMLHttpRequest";

    const finalOptions = {
        credentials: "same-origin",
        ...options,
        headers: headers
    };

    let response;

    try {
        response = await fetch(url, finalOptions);
    } catch (error) {
        console.error("Network error:", error);
        throw error;
    }

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = { success: response.ok, message: text };
    }

    if (!response.ok) {
        const error = new Error(
            data.message || `Request failed: ${response.status}`
        );
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}


/* =========================================================
   7. CONTACTS
   ========================================================= */

async function loadContacts() {

    showContactLoading(true);

    try {
        const data = await apiRequest(CONFIG.contactsUrl, { method: "GET" });

        if (!data || !Array.isArray(data.contacts)) {
            contacts = [];
        } else {
            const oldMap = new Map(
                contacts.map(function (c) { return [Number(c.id), c]; })
            );

            contacts = data.contacts.map(function (contact) {
                const old = oldMap.get(Number(contact.id));

                return {
                    ...contact,
                    last_message: old?.last_message || contact.last_message || "",
                    last_time: old?.last_time || contact.last_time || "",
                    is_online: old?.is_online || false
                };
            });
        }

        rebuildContactMap();
        renderContacts();

    } catch (error) {
        console.error("Load contacts error:", error);
        renderContactError("Unable to load contacts.");
    } finally {
        showContactLoading(false);
    }
}

function rebuildContactMap() {
    contactMap.clear();
    contacts.forEach(function (contact) {
        contactMap.set(Number(contact.id), contact);
    });
}

function getContactDisplayName(contact) {
    if (!contact) return "Unknown";

    if (contact.nickname && contact.nickname.trim()) {
        return contact.nickname;
    }

    const fullName = [contact.first_name, contact.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();

    return fullName || contact.username || "Unknown";
}

function getInitials(name) {
    if (!name) return "?";

    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return "?";

    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function normalizeContact(raw) {
    if (!raw) return null;

    return {
        id: Number(raw.id),
        username: raw.username || "",
        first_name: raw.first_name || "",
        last_name: raw.last_name || "",
        nickname: raw.nickname || "",
        unread_count: Number(raw.unread_count || 0),
        last_message: raw.last_message || "",
        last_time: raw.last_time || "",
        is_online: Boolean(raw.is_online)
    };
}

function renderContacts(searchText) {

    if (!elements.contactList) return;

    if (searchText === undefined) {
        searchText = elements.contactSearch
            ? elements.contactSearch.value.trim()
            : "";
    }

    const query = searchText.toLowerCase();

    const filtered = contacts.filter(function (contact) {
        if (!query) return true;

        return [
            contact.username,
            contact.first_name,
            contact.last_name,
            contact.nickname
        ].some(function (value) {
            return (value || "").toLowerCase().includes(query);
        });
    });

    elements.contactList.innerHTML = "";

    if (filtered.length === 0) {
        elements.contactList.appendChild(
            createEl(
                "div",
                "contact-empty",
                query ? "No contacts found" : "No contacts yet"
            )
        );
        return;
    }

    filtered.forEach(function (contact) {

        const item = createEl("div", "contact-item");

        if (Number(contact.id) === Number(selectedUserId)) {
            item.classList.add("active");
        }

        const displayName = getContactDisplayName(contact);

        const avatar = createEl("div", "contact-avatar", getInitials(displayName));
        const dot = createEl("span", "contact-online-dot");
        if (contact.is_online) dot.classList.add("online");
        avatar.appendChild(dot);

        const content = createEl("div", "contact-content");

        const top = createEl("div", "contact-top");
        top.appendChild(createEl("div", "contact-name", displayName));
        top.appendChild(createEl("div", "contact-time", contact.last_time || ""));

        const bottom = createEl("div", "contact-bottom");
        bottom.appendChild(
            createEl(
                "div",
                "contact-preview",
                contact.last_message || contact.username || ""
            )
        );

        const unread = Number(contact.unread_count || 0);

        if (unread > 0) {
            bottom.appendChild(
                createEl(
                    "span",
                    "unread-count",
                    unread > 99 ? "99+" : String(unread)
                )
            );
        }

        content.appendChild(top);
        content.appendChild(bottom);

        item.appendChild(avatar);
        item.appendChild(content);

        item.addEventListener("click", function () {
            openChat(contact);
        });

        elements.contactList.appendChild(item);
    });
}

function renderContactError(text) {
    if (!elements.contactList) return;
    elements.contactList.innerHTML = "";
    elements.contactList.appendChild(createEl("div", "contact-empty error", text));
}

function showContactLoading(show) {
    if (elements.contactLoading) {
        elements.contactLoading.classList.toggle("hidden", !show);
    }
}

function updateContactPreview(userId, text, time) {
    const contact = contactMap.get(Number(userId));
    if (!contact) return;

    contact.last_message = text || "";
    contact.last_time = time || formatMessageTime(new Date());

    renderContacts();
}

function increaseUnreadCount(userId) {
    const contact = contactMap.get(Number(userId));
    if (!contact) return;

    contact.unread_count = Number(contact.unread_count || 0) + 1;
    renderContacts();
}


/* =========================================================
   8. ADD / DELETE CONTACT
   ========================================================= */

async function handleAddContact(event) {
    event.preventDefault();

    const username = elements.contactUsernameInput
        ? elements.contactUsernameInput.value.trim()
        : "";

    if (!username) {
        showContactMessage("Please enter a username.", "error");
        return;
    }

    setButtonLoading(elements.addContactSubmitBtn, true);

    try {
        const data = await apiRequest(CONFIG.addContactUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username })
        });

        if (!data.success) {
            throw new Error(data.message || "Unable to add contact.");
        }

        showContactMessage(data.message || "Contact added successfully.", "success");

        if (elements.contactUsernameInput) {
            elements.contactUsernameInput.value = "";
        }

        await loadContacts();

        if (data.contact) {
            await openChat(normalizeContact(data.contact));
        }

        setTimeout(function () {
            closeModal("addContactModal");
        }, 700);

    } catch (error) {
        console.error("Add contact error:", error);
        showContactMessage(error.message || "Unable to add contact.", "error");
    } finally {
        setButtonLoading(elements.addContactSubmitBtn, false);
    }
}

async function handleDeleteContact() {

    if (!selectedUserId) {
        showToast("Select a contact first.", "error");
        return;
    }

    const contact = contactMap.get(Number(selectedUserId));
    const name = getContactDisplayName(contact);

    if (!window.confirm(`Delete ${name} from your contacts?`)) {
        return;
    }

    try {
        const data = await apiRequest(CONFIG.deleteContactUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: Number(selectedUserId) })
        });

        if (!data.success) {
            throw new Error(data.message || "Unable to delete contact.");
        }

        contacts = contacts.filter(function (item) {
            return Number(item.id) !== Number(selectedUserId);
        });

        rebuildContactMap();
        renderContacts();

        selectedUserId = null;
        selectedContact = null;

        if (elements.chatInterface) elements.chatInterface.classList.add("hidden");
        if (elements.emptyChat) elements.emptyChat.classList.remove("hidden");

        stopPresencePolling();
        showToast("Contact deleted.", "success");

    } catch (error) {
        console.error("Delete contact error:", error);
        showToast(error.message || "Unable to delete contact.", "error");
    }
}


/* =========================================================
   9. OPEN CHAT
   ========================================================= */

async function openChat(contact) {

    if (!contact) return;

    selectedUserId = Number(contact.id);
    selectedContact = contact;

    const existing = contactMap.get(selectedUserId);

    if (existing) {
        selectedContact = { ...existing, ...contact };
    }

    renderContacts();

    if (elements.emptyChat) elements.emptyChat.classList.add("hidden");
    if (elements.chatInterface) elements.chatInterface.classList.remove("hidden");

    updateChatHeader();
    clearMessages();

    await loadMessages(selectedUserId);
    await markCurrentChatRead(true);
    await loadPresence(selectedUserId);

    startPresencePolling();

    if (elements.messageInput) {
        elements.messageInput.focus();
    }
}

function updateChatHeader() {
    const name = getContactDisplayName(selectedContact);

    if (elements.chatUsername) elements.chatUsername.textContent = name;
    if (elements.chatAvatar) elements.chatAvatar.textContent = getInitials(name);
    if (elements.chatStatus) elements.chatStatus.textContent = "Loading...";
}


/* =========================================================
   10. LOAD MESSAGES
   ========================================================= */

async function loadMessages(userId) {

    if (!userId) return;

    showMessageLoading(true);

    try {
        const data = await apiRequest(
            `${CONFIG.messagesUrl}${userId}/`,
            { method: "GET" }
        );

        // The user may have opened another chat while we waited
        if (Number(userId) !== Number(selectedUserId)) return;

        clearMessages();

        if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
            renderEmptyMessages();
            return;
        }

        data.messages.forEach(function (message) {
            addOrUpdateMessage(message, false);
        });

        scrollMessagesToBottom();

    } catch (error) {
        console.error("Load messages error:", error);
        clearMessages();
        renderEmptyMessages("Unable to load messages.");
    } finally {
        showMessageLoading(false);
    }
}


/* =========================================================
   11. MESSAGE NORMALIZER  (MAIN FIX)
   ========================================================= */

/*
 * Accepts all of these shapes:
 *
 * 1) WebSocket (flat):
 *    { type, message_id, sender_id, receiver_id,
 *      message: "hello", created_at, ... }
 *
 * 2) HTTP API (flat):
 *    { id, sender_id, receiver_id, content: "hello", ... }
 *
 * 3) Wrapped:
 *    { message: { id, sender_id, content, ... } }
 */
function normalizeMessage(raw) {

    if (!raw || typeof raw !== "object") return null;

    const source =
        raw.message && typeof raw.message === "object"
            ? { ...raw, ...raw.message }
            : raw;

    const rawId = source.id || source.message_id || null;

    const content =
        source.content !== undefined && source.content !== null
            ? source.content
            : typeof source.message === "string"
                ? source.message
                : "";

    const mediaUrl = source.media_url || source.mediaUrl || null;

    const messageType = String(
        source.message_type || source.media_type || "text"
    ).toLowerCase();

    return {
        id: rawId ? Number(rawId) : null,

        sender_id: Number(source.sender_id || source.senderId || 0),
        receiver_id: Number(source.receiver_id || source.receiverId || 0),

        sender: source.sender || "",
        receiver: source.receiver || "",

        content: content || "",
        message: content || "",

        message_type: messageType,
        media_url: mediaUrl,
        media_type: source.media_type || null,

        is_delivered: Boolean(source.is_delivered),
        is_read: Boolean(source.is_read),

        created_at: source.created_at || "",
        time: formatMessageTime(source.created_at) || source.time || ""
    };
}

function getPreviewText(message) {
    if (message.content) return message.content;
    if (message.message_type === "image") return "📷 Image";
    if (message.message_type === "video") return "🎥 Video";
    return "";
}


/* =========================================================
   12. ADD / UPDATE MESSAGE
   ========================================================= */

function addOrUpdateMessage(rawMessage, live = true) {

    const message = normalizeMessage(rawMessage);

    if (!message) return;

    // Only show messages that belong to the open conversation
    if (
        selectedUserId &&
        message.sender_id !== Number(selectedUserId) &&
        message.receiver_id !== Number(selectedUserId)
    ) {
        return;
    }

    // Already on screen: update ticks only (no duplicate)
    if (message.id && messageElements.has(message.id)) {
        updateMessageElement(message);
        return;
    }

    clearEmptyMessageState();

    const element = createMessageElement(message);

    if (!element) return;

    if (message.id) {
        messageElements.set(message.id, element);
    }

    if (elements.messageContainer) {
        elements.messageContainer.appendChild(element);
    }

    if (live) {
        updateContactPreview(
            message.sender_id === CURRENT_USER_ID
                ? message.receiver_id
                : message.sender_id,
            getPreviewText(message),
            message.time
        );

        scrollMessagesToBottom();
    }
}

function createMessageElement(message) {

    const isSent = Number(message.sender_id) === Number(CURRENT_USER_ID);
    const side = isSent ? "sent" : "received";

    const row = createEl("div", `message-row ${side}`);

    if (message.id) {
        row.dataset.messageId = message.id;
    }

    const bubble = createEl("div", `message ${side}`);

    const isImage =
        message.message_type === "image" || message.media_type === "image";
    const isVideo =
        message.message_type === "video" || message.media_type === "video";

    if (message.media_url && isImage) {
        const image = createEl("img", "message-image");
        image.src = message.media_url;
        image.alt = "Image";
        image.loading = "lazy";
        image.addEventListener("click", function () {
            window.open(message.media_url, "_blank");
        });
        bubble.appendChild(image);

    } else if (message.media_url && isVideo) {
        const video = createEl("video", "message-video");
        video.src = message.media_url;
        video.controls = true;
        video.preload = "metadata";
        bubble.appendChild(video);
    }

    if (message.content && message.content.trim()) {
        bubble.appendChild(createEl("div", "message-text", message.content));
    }

    if (!bubble.children.length) {
        bubble.appendChild(createEl("div", "message-text", "(Media)"));
    }

    const meta = createEl("div", "message-meta");

    meta.appendChild(
        createEl(
            "span",
            "message-time",
            message.time || formatMessageTime(message.created_at)
        )
    );

    if (isSent) {
        const status = createEl(
            "span",
            getStatusClass(message),
            getStatusIcon(message)
        );
        status.dataset.status = "true";
        meta.appendChild(status);
    }

    bubble.appendChild(meta);
    row.appendChild(bubble);

    return row;
}


/* =========================================================
   13. MESSAGE STATUS (ticks)
   ========================================================= */

function getStatusClass(message) {
    if (message.is_read) return "message-status read";
    if (message.is_delivered) return "message-status delivered";
    return "message-status sent";
}

function getStatusIcon(message) {
    if (message.is_read || message.is_delivered) return "✓✓";
    return "✓";
}

function updateMessageElement(message) {

    if (!message.id) return;

    const element = messageElements.get(message.id);
    if (!element) return;

    const status = element.querySelector('[data-status="true"]');
    if (!status) return;

    status.className = getStatusClass(message);
    status.textContent = getStatusIcon(message);
}

function updateMessageStatus(messageId, status) {

    if (!messageId) return;

    const element = messageElements.get(Number(messageId));
    if (!element) return;

    const statusElement = element.querySelector('[data-status="true"]');
    if (!statusElement) return;

    if (status.is_read) {
        statusElement.className = "message-status read";
        statusElement.textContent = "✓✓";
    } else if (status.is_delivered) {
        // never downgrade a "read" tick
        if (!statusElement.classList.contains("read")) {
            statusElement.className = "message-status delivered";
            statusElement.textContent = "✓✓";
        }
    }
}

function markCurrentSentMessagesRead() {
    messageElements.forEach(function (element) {
        const status = element.querySelector('[data-status="true"]');
        if (!status) return;
        status.className = "message-status read";
        status.textContent = "✓✓";
    });
}


/* =========================================================
   14. MARK READ  (FIXED: FormData instead of JSON)
   ========================================================= */

async function markCurrentChatRead(viaHttp = true) {

    if (!selectedUserId) return;

    const senderId = Number(selectedUserId);

    if (viaHttp && CONFIG.markReadUrl) {
        try {
            const formData = new FormData();
            formData.append("sender_id", String(senderId));

            await apiRequest(CONFIG.markReadUrl, {
                method: "POST",
                body: formData
            });

        } catch (error) {
            console.warn("HTTP mark read failed:", error);
        }
    }

    sendSocketMessage({
        type: "mark_read",
        sender_id: senderId
    });

    const contact = contactMap.get(senderId);

    if (contact) {
        contact.unread_count = 0;
    }

    renderContacts();
}


/* =========================================================
   15. SEND TEXT MESSAGE
   ========================================================= */

async function handleMessageSubmit(event) {

    if (event) event.preventDefault();

    if (isSendingMessage) return;

    if (!selectedUserId) {
        showToast("Select a contact first.", "error");
        return;
    }

    const input = elements.messageInput;
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    isSendingMessage = true;

    try {

        // Preferred: WebSocket.
        // The server answers with "message_sent", which shows
        // the message on the sender's screen at once.
        const sent = sendSocketMessage({
            type: "chat_message",
            receiver_id: Number(selectedUserId),
            message: text
        });

        if (sent) {
            input.value = "";
            autoResizeMessageInput();
            return;
        }

        // HTTP fallback (only when the WebSocket is not open)
        const formData = new FormData();
        formData.append("receiver_id", String(selectedUserId));
        formData.append("message", text);

        const data = await apiRequest(CONFIG.sendMessageUrl, {
            method: "POST",
            body: formData
        });

        if (!data.success) {
            throw new Error(data.message || "Message could not be sent.");
        }

        if (data.message && typeof data.message === "object") {
            addOrUpdateMessage(data.message);
        } else {
            await loadMessages(selectedUserId);
        }

        input.value = "";
        autoResizeMessageInput();

    } catch (error) {
        console.error("Send message error:", error);
        showToast(error.message || "Message failed.", "error");
    } finally {
        isSendingMessage = false;
    }
}


/* =========================================================
   16. MEDIA UPLOAD
   ========================================================= */

async function handleMediaUpload(event) {

    const file = event.target.files && event.target.files[0];
    if (!file) return;

    event.target.value = "";

    if (!selectedUserId) {
        showToast("Select a contact first.", "error");
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showToast("Maximum file size is 50 MB.", "error");
        return;
    }

    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
        showToast("Only image and video files are allowed.", "error");
        return;
    }

    try {
        showToast("Uploading media...", "info");

        const formData = new FormData();
        formData.append("file", file);
        formData.append("receiver_id", String(selectedUserId));

        const data = await apiRequest(CONFIG.uploadMediaUrl, {
            method: "POST",
            body: formData
        });

        if (!data.success) {
            throw new Error(data.message || "Media upload failed.");
        }

        // Show to the sender if the API returned the full message
        if (data.message && typeof data.message === "object") {
            addOrUpdateMessage(data.message);
        }

        // Tell the server to notify the receiver.
        // The server answers with "media_sent" which also shows
        // the media on the sender's screen (duplicates are ignored).
        const messageId =
            data.message_id ||
            (data.message && data.message.id) ||
            data.id;

        if (messageId) {
            sendSocketMessage({
                type: "media_message",
                receiver_id: Number(selectedUserId),
                message_id: Number(messageId)
            });
        }

        showToast("Media sent.", "success");

    } catch (error) {
        console.error("Media upload error:", error);
        showToast(error.message || "Media upload failed.", "error");
    }
}


/* =========================================================
   17. WEBSOCKET
   ========================================================= */

function connectWebSocket() {

    if (!CONFIG.websocketUrl) {
        console.error("WebSocket URL is missing.");
        return;
    }

    if (
        socket &&
        (socket.readyState === WebSocket.OPEN ||
         socket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    try {
        socket = new WebSocket(CONFIG.websocketUrl);
    } catch (error) {
        console.error("WebSocket creation error:", error);
        scheduleWebSocketReconnect();
        return;
    }

    socket.addEventListener("open", handleSocketOpen);
    socket.addEventListener("message", handleSocketMessage);
    socket.addEventListener("close", handleSocketClose);
    socket.addEventListener("error", handleSocketError);
}

function handleSocketOpen() {
    console.log("WebSocket connected.");

    socketReconnectAttempts = 0;

    if (selectedUserId) {
        loadPresence(selectedUserId);
    }
}

function handleSocketClose() {
    console.warn("WebSocket disconnected.");

    if (!isUnloading) {
        scheduleWebSocketReconnect();
    }
}

function handleSocketError(error) {
    console.error("WebSocket error:", error);
}

function scheduleWebSocketReconnect() {

    if (socketReconnectTimer) return;

    socketReconnectAttempts++;

    const delay = Math.min(
        1000 * Math.pow(2, socketReconnectAttempts - 1),
        10000
    );

    socketReconnectTimer = setTimeout(function () {
        socketReconnectTimer = null;
        connectWebSocket();
    }, delay);
}

function sendSocketMessage(data) {

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(data));
        return true;
    } catch (error) {
        console.error("Socket send error:", error);
        return false;
    }
}


/* =========================================================
   18. SOCKET MESSAGE HANDLER
   ========================================================= */

async function handleIncomingMessage(message) {

    if (!message) return;

    const senderId = Number(message.sender_id || 0);

    // The chat with this sender is open: show it immediately
    if (selectedUserId && Number(selectedUserId) === senderId) {

        addOrUpdateMessage(message);

        // Only the socket is needed here (no extra HTTP call)
        await markCurrentChatRead(false);

    } else {

        increaseUnreadCount(senderId);

        updateContactPreview(
            senderId,
            getPreviewText(message) || "New message",
            message.time
        );

        showToast(
            `New message from ${
                message.sender ||
                getContactDisplayName(contactMap.get(senderId))
            }`,
            "info"
        );
    }

    await loadNotifications();
}

async function handleSocketMessage(event) {

    let data;

    try {
        data = JSON.parse(event.data);
    } catch (error) {
        console.error("Invalid WebSocket JSON:", event.data);
        return;
    }

    console.log("WebSocket:", data);

    switch (data.type) {

        case "connection":
            break;

        case "error":
            showToast(data.message || "Server error.", "error");
            break;

        /* ---- I sent a text message: show it on MY screen ---- */
        case "message_sent": {
            // IMPORTANT: pass the WHOLE object (not data.message)
            addOrUpdateMessage(data);
            break;
        }

        /* ---- I sent media: show it on MY screen ---- */
        case "media_sent": {
            addOrUpdateMessage(data);
            break;
        }

        /* ---- Someone sent me a text message ---- */
        case "chat_message": {
            await handleIncomingMessage(normalizeMessage(data));
            break;
        }

        /* ---- Someone sent me media ---- */
        case "media_message": {
            await handleIncomingMessage(normalizeMessage(data));
            break;
        }

        /* ---- Server asks me to confirm delivery ---- */
        case "request_delivery_ack": {
            const messageId = Number(data.message_id || data.id || 0);
            const senderId = Number(data.sender_id || 0);

            if (messageId && senderId) {
                sendSocketMessage({
                    type: "message_delivered",
                    sender_id: senderId,
                    message_id: messageId
                });
            }
            break;
        }

        /* ---- My message was delivered ---- */
        case "message_delivered": {
            updateMessageStatus(
                Number(data.message_id || data.id || 0),
                { is_delivered: true }
            );
            break;
        }

        /* ---- My messages were read ---- */
        case "messages_read": {
            if (Array.isArray(data.message_ids)) {
                data.message_ids.forEach(function (id) {
                    updateMessageStatus(Number(id), {
                        is_delivered: true,
                        is_read: true
                    });
                });
            } else {
                markCurrentSentMessagesRead();
            }
            break;
        }

        /* ---- Voice calls ---- */
        case "call_offer":
            await handleIncomingCall(data);
            break;

        case "call_answer":
            await handleCallAnswer(data);
            break;

        case "ice_candidate":
            await handleIceCandidate(data);
            break;

        case "call_rejected":
            showToast("Call rejected.", "error");
            updateCallStatus("Call rejected");
            setTimeout(cleanupCall, 1000);
            break;

        case "call_ended":
            updateCallStatus("Call ended");
            setTimeout(cleanupCall, 500);
            break;

        default:
            console.log("Unhandled WebSocket event:", data.type, data);
            break;
    }
}


/* =========================================================
   19. MESSAGE AREA HELPERS
   ========================================================= */

function clearMessages() {

    messageElements.clear();

    if (!elements.messageContainer) return;

    elements.messageContainer.innerHTML = "";

    if (elements.messageLoading) {
        elements.messageContainer.appendChild(elements.messageLoading);
    }
}

function renderEmptyMessages(text = "No messages yet") {

    if (!elements.messageContainer) return;

    clearEmptyMessageState();

    elements.messageContainer.appendChild(
        createEl("div", "message-empty", text)
    );
}

function clearEmptyMessageState() {

    if (!elements.messageContainer) return;

    const empty = elements.messageContainer.querySelector(".message-empty");
    if (empty) empty.remove();

    const oldEmpty = elements.messageContainer.querySelector(".empty-contacts");
    if (oldEmpty) oldEmpty.remove();
}

function showMessageLoading(show) {
    if (elements.messageLoading) {
        elements.messageLoading.classList.toggle("hidden", !show);
    }
}

function scrollMessagesToBottom() {

    if (!elements.messageContainer) return;

    requestAnimationFrame(function () {
        elements.messageContainer.scrollTop =
            elements.messageContainer.scrollHeight;
    });
}

function autoResizeMessageInput() {

    if (!elements.messageInput) return;

    // Your HTML uses <input type="text">, which must keep its height.
    if (elements.messageInput.tagName !== "TEXTAREA") return;

    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height =
        Math.min(elements.messageInput.scrollHeight, 120) + "px";
}


/* =========================================================
   20. PRESENCE
   ========================================================= */

async function loadPresence(userId) {

    if (!userId) return;

    try {
        const data = await apiRequest(
            `${CONFIG.presenceUrl || "/api/users/"}${userId}/presence/`,
            { method: "GET" }
        );

        const contact = contactMap.get(Number(userId));

        if (contact) {
            contact.is_online = Boolean(data.is_online);
        }

        // Ignore a late answer for a chat that is no longer open
        if (Number(userId) === Number(selectedUserId)) {
            updatePresenceUI(data);
        }

        renderContacts();

    } catch (error) {
        console.warn("Presence error:", error);
    }
}

function updatePresenceUI(data) {

    if (!elements.chatStatus) return;

    if (data.is_online) {
        elements.chatStatus.textContent = "online";
    } else if (data.last_seen) {
        elements.chatStatus.textContent =
            `last seen ${formatLastSeen(data.last_seen)}`;
    } else {
        elements.chatStatus.textContent = "offline";
    }
}

function startPresencePolling() {

    stopPresencePolling();

    if (!selectedUserId) return;

    presenceTimer = setInterval(function () {
        if (selectedUserId) {
            loadPresence(selectedUserId);
        }
    }, 10000);
}

function stopPresencePolling() {
    if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
    }
}


/* =========================================================
   21. NOTIFICATIONS
   ========================================================= */

async function loadNotifications() {

    if (!CONFIG.notificationsUrl) return;

    try {
        const data = await apiRequest(CONFIG.notificationsUrl, {
            method: "GET"
        });

        updateNotificationCount(Number(data.unread_count || 0));
        renderNotifications(data.notifications || []);

    } catch (error) {
        console.warn("Notifications error:", error);
    }
}

function updateNotificationCount(count) {

    if (!elements.notificationCount) return;

    if (count > 0) {
        elements.notificationCount.textContent = count > 99 ? "99+" : String(count);
        elements.notificationCount.classList.remove("hidden");
    } else {
        elements.notificationCount.textContent = "";
        elements.notificationCount.classList.add("hidden");
    }
}

function renderNotifications(notifications) {

    if (!elements.notificationList) return;

    elements.notificationList.innerHTML = "";

    if (!notifications || notifications.length === 0) {
        elements.notificationList.appendChild(
            createEl("div", "notification-empty", "No notifications")
        );
        return;
    }

    notifications.forEach(function (notification) {

        const item = createEl("div", "notification-item");

        if (!notification.is_read) item.classList.add("unread");

        item.appendChild(
            createEl(
                "div",
                "notification-title",
                notification.sender || "Notification"
            )
        );

        item.appendChild(
            createEl(
                "div",
                "notification-message",
                notification.message || ""
            )
        );

        item.appendChild(
            createEl(
                "div",
                "notification-time",
                notification.time || formatMessageTime(notification.created_at)
            )
        );

        elements.notificationList.appendChild(item);
    });
}


/* =========================================================
   22. VOICE CALL (WebRTC)
   ========================================================= */

function createPeerConnection(userId) {

    currentCallUserId = Number(userId);

    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.onicecandidate = function (event) {

        if (!event.candidate) return;

        sendSocketMessage({
            type: "ice_candidate",
            receiver_id: Number(currentCallUserId),
            candidate: event.candidate
        });
    };

    peerConnection.ontrack = function (event) {

        console.log("Remote audio received.");

        if (elements.remoteAudio) {
            elements.remoteAudio.srcObject = event.streams[0];

            elements.remoteAudio.play().catch(function (error) {
                console.warn("Audio autoplay blocked:", error);

                if (elements.enableAudioBtn) {
                    elements.enableAudioBtn.classList.remove("hidden");
                }
            });
        }
    };

    peerConnection.onconnectionstatechange = function () {

        if (!peerConnection) return;

        const state = peerConnection.connectionState;

        console.log("WebRTC connection state:", state);

        if (state === "connected") {
            callStarted = true;
            updateCallStatus("Connected");
        } else if (state === "connecting") {
            updateCallStatus("Connecting...");
        } else if (state === "disconnected") {
            updateCallStatus("Disconnected");
        } else if (state === "failed") {
            updateCallStatus("Connection failed");
            showToast("Voice call connection failed.", "error");
        }
    };

    peerConnection.oniceconnectionstatechange = function () {
        if (!peerConnection) return;
        console.log("ICE state:", peerConnection.iceConnectionState);
    };

    return peerConnection;
}

async function getMicrophone() {
    return navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
    });
}

function addLocalTracks() {
    localStream.getTracks().forEach(function (track) {
        peerConnection.addTrack(track, localStream);
    });
}

async function startVoiceCall() {

    if (!selectedUserId) {
        showToast("Select a contact first.", "error");
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showToast("Connecting to server...", "error");
        connectWebSocket();
        return;
    }

    try {
        currentCallUserId = Number(selectedUserId);
        currentCallUsername = getContactDisplayName(selectedContact);

        localStream = await getMicrophone();

        createPeerConnection(currentCallUserId);
        addLocalTracks();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        openCallModal(currentCallUsername);
        updateCallStatus("Calling...");

        const sent = sendSocketMessage({
            type: "call_offer",
            receiver_id: Number(currentCallUserId),
            offer: offer
        });

        if (!sent) {
            throw new Error("Unable to send call request.");
        }

    } catch (error) {
        console.error("Start call error:", error);
        showToast(
            "Unable to start voice call. Please allow microphone access.",
            "error"
        );
        cleanupCall();
    }
}

async function handleIncomingCall(data) {

    try {
        incomingCallerId = Number(
            data.caller_id || data.sender_id || data.user_id || 0
        );

        incomingCallerName =
            data.caller_username ||
            data.sender ||
            data.username ||
            getContactDisplayName(contactMap.get(incomingCallerId)) ||
            "Unknown";

        incomingOffer = data.offer;

        if (!incomingCallerId || !incomingOffer) {
            console.error("Invalid incoming call data:", data);
            return;
        }

        currentCallUserId = incomingCallerId;
        currentCallUsername = incomingCallerName;

        if (elements.incomingCallerName) {
            elements.incomingCallerName.textContent = incomingCallerName;
        }

        if (elements.incomingCallAvatar) {
            elements.incomingCallAvatar.textContent =
                getInitials(incomingCallerName);
        }

        openModal("incomingCallModal");

    } catch (error) {
        console.error("Incoming call error:", error);
    }
}

async function acceptIncomingCall() {

    if (!incomingCallerId || !incomingOffer) return;

    try {
        closeModal("incomingCallModal");

        currentCallUserId = Number(incomingCallerId);
        currentCallUsername = incomingCallerName || "Voice Call";

        localStream = await getMicrophone();

        createPeerConnection(currentCallUserId);
        addLocalTracks();

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(incomingOffer)
        );

        await flushPendingIceCandidates();

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        openCallModal(currentCallUsername);
        updateCallStatus("Connecting...");

        sendSocketMessage({
            type: "call_answer",
            caller_id: Number(currentCallUserId),
            receiver_id: Number(currentCallUserId),
            answer: answer
        });

        incomingOffer = null;

    } catch (error) {
        console.error("Accept call error:", error);
        showToast("Unable to accept call.", "error");
        cleanupCall();
    }
}

async function handleCallAnswer(data) {

    try {
        if (!peerConnection) {
            console.warn("No peer connection for answer.");
            return;
        }

        if (!data.answer) {
            console.error("Answer not found.");
            return;
        }

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );

        await flushPendingIceCandidates();

        updateCallStatus("Connecting...");

    } catch (error) {
        console.error("Call answer error:", error);
        showToast("Unable to establish voice call.", "error");
    }
}

async function handleIceCandidate(data) {

    if (!data.candidate) return;

    if (!peerConnection || !peerConnection.remoteDescription) {
        pendingIceCandidates.push(data.candidate);
        return;
    }

    try {
        await peerConnection.addIceCandidate(
            new RTCIceCandidate(data.candidate)
        );
    } catch (error) {
        console.error("ICE candidate error:", error);
    }
}

async function flushPendingIceCandidates() {

    if (!peerConnection || !peerConnection.remoteDescription) return;

    const candidates = [...pendingIceCandidates];
    pendingIceCandidates = [];

    for (const candidate of candidates) {
        try {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        } catch (error) {
            console.error("Pending ICE error:", error);
        }
    }
}

function rejectIncomingCall() {

    const callerId = incomingCallerId || currentCallUserId;

    if (callerId) {
        // FIX: send both names so the server always finds the caller
        sendSocketMessage({
            type: "call_rejected",
            caller_id: Number(callerId),
            receiver_id: Number(callerId)
        });
    }

    closeModal("incomingCallModal");

    incomingOffer = null;
    incomingCallerId = null;
    currentCallUserId = null;

    showToast("Call rejected.", "info");
}

function endCurrentCall() {

    if (currentCallUserId) {
        sendSocketMessage({
            type: "call_ended",
            receiver_id: Number(currentCallUserId)
        });
    }

    cleanupCall();
}

function cleanupCall() {

    if (localStream) {
        localStream.getTracks().forEach(function (track) {
            track.stop();
        });
        localStream = null;
    }

    if (peerConnection) {
        try {
            peerConnection.ontrack = null;
            peerConnection.onicecandidate = null;
            peerConnection.close();
        } catch (error) {
            console.warn(error);
        }
        peerConnection = null;
    }

    pendingIceCandidates = [];

    incomingOffer = null;
    incomingCallerId = null;

    currentCallUserId = null;
    currentCallUsername = "";

    callStarted = false;

    if (elements.remoteAudio) {
        elements.remoteAudio.srcObject = null;
    }

    if (elements.enableAudioBtn) {
        elements.enableAudioBtn.classList.add("hidden");
    }

    closeModal("callModal");
    closeModal("incomingCallModal");
}

function openCallModal(username) {

    if (elements.callUserName) {
        elements.callUserName.textContent = username || "Voice Call";
    }

    if (elements.callAvatar) {
        elements.callAvatar.textContent = getInitials(username || "Voice Call");
    }

    openModal("callModal");
}

function updateCallStatus(text) {
    if (elements.callStatus) {
        elements.callStatus.textContent = text;
    }
}


/* =========================================================
   23. MODAL / TOAST / BUTTON HELPERS
   ========================================================= */

function openModal(modalId) {
    const modal = $(modalId);
    if (modal) modal.classList.remove("hidden");
}

function closeModal(modalId) {
    const modal = $(modalId);
    if (modal) modal.classList.add("hidden");
}

function showToast(message, type = "info") {

    if (!elements.toastContainer) {
        console.log(message);
        return;
    }

    const toast = createEl("div", `app-toast ${type}`, message);

    elements.toastContainer.appendChild(toast);

    setTimeout(function () {
        toast.classList.add("show");
    }, 10);

    setTimeout(function () {
        toast.classList.remove("show");
        setTimeout(function () {
            toast.remove();
        }, 300);
    }, 3000);
}

function showContactMessage(message, type = "info") {

    if (!elements.contactMessage) {
        showToast(message, type);
        return;
    }

    elements.contactMessage.textContent = message;
    elements.contactMessage.className = `contact-message form-message ${type}`;
}

function setButtonLoading(button, loading) {

    if (!button) return;

    if (loading) {
        button.dataset.originalText = button.textContent;
        button.textContent = "Please wait...";
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || "Add Contact";
        button.disabled = false;
    }
}


/* =========================================================
   24. DATE / TIME FORMATTING
   ========================================================= */

function formatMessageTime(value) {

    if (!value) return "";

    let date;

    if (value instanceof Date) {
        date = value;
    } else {
        const stringValue = String(value);

        if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(stringValue)) {
            date = new Date(stringValue.replace(" ", "T"));
        } else {
            date = new Date(stringValue);
        }
    }

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatLastSeen(value) {

    if (!value) return "";

    const date = new Date(String(value).replace(" ", "T"));

    if (Number.isNaN(date.getTime())) return String(value);

    const diff = Date.now() - date.getTime();

    const oneMinute = 60 * 1000;
    const oneHour = 60 * oneMinute;
    const oneDay = 24 * oneHour;

    if (diff < oneMinute) return "just now";

    if (diff < oneHour) {
        return `${Math.floor(diff / oneMinute)} min ago`;
    }

    if (diff < oneDay) {
        return `${Math.floor(diff / oneHour)} hr ago`;
    }

    return date.toLocaleString([], {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}


/* =========================================================
   25. GLOBAL ERROR LOGGER
   ========================================================= */

window.addEventListener("error", function (event) {
    console.error("JavaScript error:", event.error || event.message);
});

console.log("WhatsApp Chat JS loaded successfully.");