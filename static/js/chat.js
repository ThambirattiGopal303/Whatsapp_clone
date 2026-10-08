/* =========================================================
   WHATSAPP CLONE
   MAIN CHAT JAVASCRIPT
   =========================================================
   IMPORTANT:
   Replace your COMPLETE old chat.js with this file.

   Matches:
   - chat/index.html
   - chat/urls.py
   - Django Channels consumer
   ========================================================= */

"use strict";


/* =========================================================
   1. CONFIGURATION
   ========================================================= */

const CONFIG = window.WHATSAPP_CONFIG || {};

const CURRENT_USER_ID = Number(
    CONFIG.currentUserId || document.body.dataset.userId || 0
);

const CURRENT_USERNAME =
    CONFIG.currentUsername ||
    document.body.dataset.username ||
    "";


/* =========================================================
   2. GLOBAL STATE
   ========================================================= */

let socket = null;

let socketReconnectTimer = null;
let socketReconnectAttempts = 0;
let socketWasConnected = false;

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
   3. DOM HELPER
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}


/* =========================================================
   4. DOM ELEMENTS
   ========================================================= */

let elements = {};


/* =========================================================
   5. INITIALIZATION
   ========================================================= */

document.addEventListener("DOMContentLoaded", function () {

    cacheElements();

    initializeApplication();

});


function cacheElements() {

    elements = {

        /* Main */
        whatsappContainer: $("whatsappContainer"),

        /* Header */
        addContactBtn: $("addContactBtn"),
        notificationBtn: $("notificationBtn"),
        notificationCount: $("notificationCount"),

        /* Contacts */
        contactSearch: $("contactSearch"),
        contactList: $("contactList"),
        contactLoading: $("contactLoading"),

        /* Chat */
        chatArea: $("chatArea"),
        emptyChat: $("emptyChat"),
        chatInterface: $("chatInterface"),

        chatAvatar: $("chatAvatar"),
        chatUsername: $("chatUsername"),
        chatStatus: $("chatStatus"),

        voiceCallBtn: $("voiceCallBtn"),
        chatMenuBtn: $("chatMenuBtn"),
        contactMenu: $("contactMenu"),
        deleteContactBtn: $("deleteContactBtn"),

        /* Messages */
        messageContainer: $("messageContainer"),
        messageLoading: $("messageLoading"),
        typingIndicator: $("typingIndicator"),

        /* Message form */
        messageForm: $("messageForm"),
        attachBtn: $("attachBtn"),
        mediaInput: $("mediaInput"),
        messageInput: $("messageInput"),
        sendMessageBtn: $("sendMessageBtn"),

        /* Add contact modal */
        addContactModal: $("addContactModal"),
        addContactForm: $("addContactForm"),
        contactUsernameInput: $("contactUsernameInput"),
        contactMessage: $("contactMessage"),
        addContactSubmitBtn: $("addContactSubmitBtn"),

        /* Notifications */
        notificationModal: $("notificationModal"),
        notificationList: $("notificationList"),

        /* Call */
        callModal: $("callModal"),
        callAvatar: $("callAvatar"),
        callUserName: $("callUserName"),
        callStatus: $("callStatus"),
        endCallBtn: $("endCallBtn"),

        /* Incoming call */
        incomingCallModal: $("incomingCallModal"),
        incomingCallAvatar: $("incomingCallAvatar"),
        incomingCallerName: $("incomingCallerName"),
        rejectCallBtn: $("rejectCallBtn"),
        acceptCallBtn: $("acceptCallBtn"),

        /* Audio */
        remoteAudio: $("remoteAudio"),

        /* Toast */
        toastContainer: $("toastContainer")
    };
}


/* =========================================================
   6. APPLICATION START
   ========================================================= */

async function initializeApplication() {

    if (!CURRENT_USER_ID) {

        console.error(
            "Current user ID was not found."
        );

        showToast(
            "User information is missing.",
            "error"
        );

        return;
    }


    bindEvents();

    connectWebSocket();

    await loadContacts();

    await loadNotifications();

}


/* =========================================================
   7. EVENT BINDINGS
   ========================================================= */

function bindEvents() {

    /* Add contact */
    if (elements.addContactBtn) {

        elements.addContactBtn.addEventListener(
            "click",
            function () {

                openModal("addContactModal");

                if (elements.contactUsernameInput) {
                    elements.contactUsernameInput.focus();
                }

            }
        );

    }


    /* Add contact form */
    if (elements.addContactForm) {

        elements.addContactForm.addEventListener(
            "submit",
            handleAddContact
        );

    }


    /* Search */
    if (elements.contactSearch) {

        elements.contactSearch.addEventListener(
            "input",
            function () {

                renderContacts(
                    elements.contactSearch.value.trim()
                );

            }
        );

    }


    /* Message form */
    if (elements.messageForm) {

        elements.messageForm.addEventListener(
            "submit",
            handleMessageSubmit
        );

    }


    /* Enter key */
    if (elements.messageInput) {

        elements.messageInput.addEventListener(
            "keydown",
            function (event) {

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    handleMessageSubmit(event);

                }

            }
        );

    }


    /* Attach */
    if (elements.attachBtn) {

        elements.attachBtn.addEventListener(
            "click",
            function () {

                if (elements.mediaInput) {
                    elements.mediaInput.click();
                }

            }
        );

    }


    /* Media */
    if (elements.mediaInput) {

        elements.mediaInput.addEventListener(
            "change",
            handleMediaUpload
        );

    }


    /* Voice call */
    if (elements.voiceCallBtn) {

        elements.voiceCallBtn.addEventListener(
            "click",
            startVoiceCall
        );

    }


    /* End call */
    if (elements.endCallBtn) {

        elements.endCallBtn.addEventListener(
            "click",
            endCurrentCall
        );

    }


    /* Accept call */
    if (elements.acceptCallBtn) {

        elements.acceptCallBtn.addEventListener(
            "click",
            acceptIncomingCall
        );

    }


    /* Reject call */
    if (elements.rejectCallBtn) {

        elements.rejectCallBtn.addEventListener(
            "click",
            rejectIncomingCall
        );

    }


    /* Notification */
    if (elements.notificationBtn) {

        elements.notificationBtn.addEventListener(
            "click",
            async function () {

                openModal("notificationModal");

                await loadNotifications();

            }
        );

    }


    /* Chat menu */
    if (elements.chatMenuBtn) {

        elements.chatMenuBtn.addEventListener(
            "click",
            function (event) {

                event.stopPropagation();

                if (!elements.contactMenu) {
                    return;
                }

                elements.contactMenu.classList.toggle(
                    "hidden"
                );

            }
        );

    }


    /* Delete contact */
    if (elements.deleteContactBtn) {

        elements.deleteContactBtn.addEventListener(
            "click",
            handleDeleteContact
        );

    }


    /* Modal close buttons */
    document
        .querySelectorAll("[data-close-modal]")
        .forEach(function (button) {

            button.addEventListener(
                "click",
                function () {

                    const modalId =
                        button.dataset.closeModal;

                    closeModal(modalId);

                }
            );

        });


    /* Click outside modal */
    document
        .querySelectorAll(".modal-overlay")
        .forEach(function (modal) {

            modal.addEventListener(
                "click",
                function (event) {

                    if (
                        event.target === modal
                    ) {

                        modal.classList.add(
                            "hidden"
                        );

                    }

                }
            );

        });


    /* Close menu when clicking elsewhere */
    document.addEventListener(
        "click",
        function () {

            if (elements.contactMenu) {

                elements.contactMenu.classList.add(
                    "hidden"
                );

            }

        }
    );


    /* Prevent menu itself from closing */
    if (elements.contactMenu) {

        elements.contactMenu.addEventListener(
            "click",
            function (event) {

                event.stopPropagation();

            }
        );

    }


    /* Page visibility */
    document.addEventListener(
        "visibilitychange",
        function () {

            if (
                document.visibilityState ===
                "visible"
            ) {

                if (
                    !socket ||
                    socket.readyState !==
                    WebSocket.OPEN
                ) {

                    connectWebSocket();

                }

                if (selectedUserId) {

                    loadPresence(
                        selectedUserId
                    );

                }

            }

        }
    );


    /* Before leaving page */
    window.addEventListener(
        "beforeunload",
        function () {

            stopPresencePolling();

            if (socket) {

                try {
                    socket.close();
                } catch (error) {
                    console.warn(error);
                }

            }

            cleanupCall(false);

        }
    );

}


/* =========================================================
   8. CSRF
   ========================================================= */

function getCSRFToken() {

    const meta =
        document.querySelector(
            'meta[name="csrf-token"]'
        );

    if (
        meta &&
        meta.getAttribute("content")
    ) {

        return meta.getAttribute("content");

    }


    const cookies =
        document.cookie.split(";");


    for (let cookie of cookies) {

        cookie = cookie.trim();

        if (
            cookie.startsWith(
                "csrftoken="
            )
        ) {

            return decodeURIComponent(
                cookie.substring(
                    "csrftoken=".length
                )
            );

        }

    }

    return "";

}


/* =========================================================
   9. API REQUEST HELPER
   ========================================================= */

async function apiRequest(
    url,
    options = {}
) {

    const headers =
        options.headers || {};

    const csrfToken =
        getCSRFToken();


    if (
        options.method &&
        options.method.toUpperCase() !== "GET"
    ) {

        headers["X-CSRFToken"] =
            csrfToken;

    }


    headers["X-Requested-With"] =
        "XMLHttpRequest";


    const finalOptions = {
        credentials: "same-origin",
        ...options,
        headers: headers
    };


    let response;

    try {

        response =
            await fetch(
                url,
                finalOptions
            );

    } catch (error) {

        console.error(
            "Network error:",
            error
        );

        throw error;

    }


    const contentType =
        response.headers.get(
            "content-type"
        ) || "";


    let data;


    if (
        contentType.includes(
            "application/json"
        )
    ) {

        data = await response.json();

    } else {

        const text =
            await response.text();

        data = {
            success: response.ok,
            message: text
        };

    }


    if (!response.ok) {

        const error =
            new Error(
                data.message ||
                `Request failed: ${response.status}`
            );

        error.status =
            response.status;

        error.data = data;

        throw error;

    }


    return data;

}


/* =========================================================
   10. CONTACTS
   ========================================================= */

async function loadContacts() {

    showContactLoading(true);

    try {

        const data =
            await apiRequest(
                CONFIG.contactsUrl,
                {
                    method: "GET"
                }
            );


        if (
            !data ||
            !Array.isArray(data.contacts)
        ) {

            contacts = [];

        } else {

            const oldMap =
                new Map(
                    contacts.map(
                        contact => [
                            Number(contact.id),
                            contact
                        ]
                    )
                );


            contacts =
                data.contacts.map(
                    function (contact) {

                        const old =
                            oldMap.get(
                                Number(contact.id)
                            );

                        return {
                            ...contact,
                            last_message:
                                old?.last_message ||
                                "",
                            last_time:
                                old?.last_time ||
                                "",
                            is_online:
                                old?.is_online ||
                                false
                        };

                    }
                );

        }


        rebuildContactMap();

        renderContacts();

    } catch (error) {

        console.error(
            "Load contacts error:",
            error
        );

        renderContactError(
            "Unable to load contacts."
        );

    } finally {

        showContactLoading(false);

    }

}


function rebuildContactMap() {

    contactMap.clear();

    contacts.forEach(
        function (contact) {

            contactMap.set(
                Number(contact.id),
                contact
            );

        }
    );

}


/* =========================================================
   11. RENDER CONTACTS
   ========================================================= */

function renderContacts(
    searchText = ""
) {

    if (!elements.contactList) {
        return;
    }


    const query =
        searchText.toLowerCase();


    const filtered =
        contacts.filter(
            function (contact) {

                if (!query) {
                    return true;
                }

                const username =
                    (
                        contact.username ||
                        ""
                    ).toLowerCase();

                const firstName =
                    (
                        contact.first_name ||
                        ""
                    ).toLowerCase();

                const lastName =
                    (
                        contact.last_name ||
                        ""
                    ).toLowerCase();

                const nickname =
                    (
                        contact.nickname ||
                        ""
                    ).toLowerCase();


                return (
                    username.includes(query) ||
                    firstName.includes(query) ||
                    lastName.includes(query) ||
                    nickname.includes(query)
                );

            }
        );


    elements.contactList.innerHTML = "";


    if (filtered.length === 0) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "contact-empty";

        empty.textContent =
            query
                ? "No contacts found"
                : "No contacts yet";

        elements.contactList.appendChild(
            empty
        );

        return;
    }


    filtered.forEach(
        function (contact) {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "contact-item";


            if (
                Number(contact.id) ===
                Number(selectedUserId)
            ) {

                item.classList.add(
                    "active"
                );

            }


            const avatar =
                document.createElement(
                    "div"
                );

            avatar.className =
                "contact-avatar";


            avatar.textContent =
                getInitials(
                    getContactDisplayName(
                        contact
                    )
                );


            const onlineDot =
                document.createElement(
                    "span"
                );

            onlineDot.className =
                "contact-online-dot";


            if (
                contact.is_online
            ) {

                onlineDot.classList.add(
                    "online"
                );

            }


            avatar.appendChild(
                onlineDot
            );


            const content =
                document.createElement(
                    "div"
                );

            content.className =
                "contact-content";


            const top =
                document.createElement(
                    "div"
                );

            top.className =
                "contact-top";


            const name =
                document.createElement(
                    "div"
                );

            name.className =
                "contact-name";

            name.textContent =
                getContactDisplayName(
                    contact
                );


            const time =
                document.createElement(
                    "div"
                );

            time.className =
                "contact-time";

            time.textContent =
                contact.last_time || "";


            top.appendChild(name);
            top.appendChild(time);


            const bottom =
                document.createElement(
                    "div"
                );

            bottom.className =
                "contact-bottom";


            const preview =
                document.createElement(
                    "div"
                );

            preview.className =
                "contact-preview";

            preview.textContent =
                contact.last_message ||
                contact.username ||
                "";


            bottom.appendChild(
                preview
            );


            const unread =
                Number(
                    contact.unread_count || 0
                );


            if (unread > 0) {

                const badge =
                    document.createElement(
                        "span"
                    );

                badge.className =
                    "unread-count";

                badge.textContent =
                    unread > 99
                        ? "99+"
                        : String(unread);

                bottom.appendChild(
                    badge
                );

            }


            content.appendChild(top);
            content.appendChild(bottom);


            item.appendChild(avatar);
            item.appendChild(content);


            item.addEventListener(
                "click",
                function () {

                    openChat(
                        contact
                    );

                }
            );


            elements.contactList.appendChild(
                item
            );

        }
    );

}


/* =========================================================
   12. CONTACT HELPERS
   ========================================================= */

function getContactDisplayName(
    contact
) {

    if (!contact) {
        return "Unknown";
    }


    if (
        contact.nickname &&
        contact.nickname.trim()
    ) {

        return contact.nickname;

    }


    const fullName =
        [
            contact.first_name,
            contact.last_name
        ]
            .filter(Boolean)
            .join(" ")
            .trim();


    return (
        fullName ||
        contact.username ||
        "Unknown"
    );

}


function getInitials(name) {

    if (!name) {
        return "?";
    }


    const parts =
        name
            .trim()
            .split(/\s+/)
            .filter(Boolean);


    if (parts.length === 1) {

        return parts[0]
            .substring(0, 2)
            .toUpperCase();

    }


    return (
        parts[0][0] +
        parts[parts.length - 1][0]
    ).toUpperCase();

}


/* =========================================================
   13. ADD CONTACT
   ========================================================= */

async function handleAddContact(
    event
) {

    event.preventDefault();


    const username =
        elements.contactUsernameInput
            ? elements.contactUsernameInput.value.trim()
            : "";


    if (!username) {

        showContactMessage(
            "Please enter a username.",
            "error"
        );

        return;

    }


    setButtonLoading(
        elements.addContactSubmitBtn,
        true
    );


    try {

        const data =
            await apiRequest(
                CONFIG.addContactUrl,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        username: username
                    })
                }
            );


        if (!data.success) {

            throw new Error(
                data.message ||
                "Unable to add contact."
            );

        }


        showContactMessage(
            data.message ||
            "Contact added successfully.",
            "success"
        );


        if (
            elements.contactUsernameInput
        ) {

            elements.contactUsernameInput.value =
                "";

        }


        await loadContacts();


        if (
            data.contact
        ) {

            const contact =
                normalizeContact(
                    data.contact
                );

            await openChat(
                contact
            );

        }


        setTimeout(
            function () {

                closeModal(
                    "addContactModal"
                );

            },
            700
        );


    } catch (error) {

        console.error(
            "Add contact error:",
            error
        );

        showContactMessage(
            error.message ||
            "Unable to add contact.",
            "error"
        );

    } finally {

        setButtonLoading(
            elements.addContactSubmitBtn,
            false
        );

    }

}


/* =========================================================
   14. DELETE CONTACT
   ========================================================= */

async function handleDeleteContact() {

    if (!selectedUserId) {

        showToast(
            "Select a contact first.",
            "error"
        );

        return;

    }


    const contact =
        contactMap.get(
            Number(selectedUserId)
        );


    const name =
        getContactDisplayName(
            contact
        );


    const confirmed =
        window.confirm(
            `Delete ${name} from your contacts?`
        );


    if (!confirmed) {
        return;
    }


    try {

        const data =
            await apiRequest(
                CONFIG.deleteContactUrl,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({
                        user_id:
                            Number(
                                selectedUserId
                            )
                    })
                }
            );


        if (!data.success) {

            throw new Error(
                data.message ||
                "Unable to delete contact."
            );

        }


        contacts =
            contacts.filter(
                function (item) {

                    return Number(item.id) !==
                        Number(selectedUserId);

                }
            );


        rebuildContactMap();

        renderContacts();


        selectedUserId = null;
        selectedContact = null;


        if (elements.chatInterface) {

            elements.chatInterface.classList.add(
                "hidden"
            );

        }


        if (elements.emptyChat) {

            elements.emptyChat.classList.remove(
                "hidden"
            );

        }


        stopPresencePolling();

        showToast(
            "Contact deleted.",
            "success"
        );


    } catch (error) {

        console.error(
            "Delete contact error:",
            error
        );

        showToast(
            error.message ||
            "Unable to delete contact.",
            "error"
        );

    }

}


/* =========================================================
   15. OPEN CHAT
   ========================================================= */

async function openChat(
    contact
) {

    if (!contact) {
        return;
    }


    selectedUserId =
        Number(contact.id);

    selectedContact =
        contact;


    const existing =
        contactMap.get(
            selectedUserId
        );


    if (existing) {

        selectedContact =
            {
                ...existing,
                ...contact
            };

    }


    renderContacts(
        elements.contactSearch
            ? elements.contactSearch.value.trim()
            : ""
    );


    /* Hide empty screen */
    if (elements.emptyChat) {

        elements.emptyChat.classList.add(
            "hidden"
        );

    }


    /* Show chat */
    if (elements.chatInterface) {

        elements.chatInterface.classList.remove(
            "hidden"
        );

    }


    updateChatHeader();


    clearMessages();


    await loadMessages(
        selectedUserId
    );


    await markCurrentChatRead();


    await loadPresence(
        selectedUserId
    );


    startPresencePolling();

}


/* =========================================================
   16. CHAT HEADER
   ========================================================= */

function updateChatHeader() {

    const name =
        getContactDisplayName(
            selectedContact
        );


    if (elements.chatUsername) {

        elements.chatUsername.textContent =
            name;

    }


    if (elements.chatAvatar) {

        elements.chatAvatar.textContent =
            getInitials(name);

    }


    if (elements.chatStatus) {

        elements.chatStatus.textContent =
            "Loading...";

    }

}


/* =========================================================
   17. LOAD MESSAGES
   ========================================================= */

async function loadMessages(
    userId
) {

    if (!userId) {
        return;
    }


    showMessageLoading(true);


    try {

        const url =
            `${CONFIG.messagesUrl}${userId}/`;


        const data =
            await apiRequest(
                url,
                {
                    method: "GET"
                }
            );


        if (
            !data ||
            !Array.isArray(data.messages)
        ) {

            renderEmptyMessages();

            return;

        }


        clearMessages();


        if (
            data.messages.length === 0
        ) {

            renderEmptyMessages();

            return;

        }


        data.messages.forEach(
            function (message) {

                addOrUpdateMessage(
                    message,
                    false
                );

            }
        );


        scrollMessagesToBottom();


    } catch (error) {

        console.error(
            "Load messages error:",
            error
        );

        clearMessages();

        renderEmptyMessages(
            "Unable to load messages."
        );

    } finally {

        showMessageLoading(false);

    }

}


/* =========================================================
   18. MESSAGE NORMALIZER
   ========================================================= */

function normalizeMessage(
    raw
) {

    if (!raw) {
        return null;
    }


    const source =
        raw.message &&
        typeof raw.message === "object"
            ? {
                ...raw,
                ...raw.message
            }
            : raw;


    const senderId =
        Number(
            source.sender_id ||
            source.senderId ||
            0
        );


    const receiverId =
        Number(
            source.receiver_id ||
            source.receiverId ||
            0
        );


    const content =
        source.content ??
        source.message ??
        "";


    const messageType =
        (
            source.message_type ||
            source.media_type ||
            "text"
        ).toLowerCase();


    const mediaUrl =
        source.media_url ||
        source.mediaUrl ||
        null;


    return {

        id:
            source.id
                ? Number(source.id)
                : null,

        sender_id:
            senderId,

        receiver_id:
            receiverId,

        sender:
            source.sender || "",

        receiver:
            source.receiver || "",

        content:
            content || "",

        message:
            content || "",

        message_type:
            messageType,

        media_url:
            mediaUrl,

        media_type:
            source.media_type ||
            null,

        is_delivered:
            Boolean(
                source.is_delivered
            ),

        is_read:
            Boolean(
                source.is_read
            ),

        created_at:
            source.created_at ||
            "",

        time:
            source.time ||
            formatMessageTime(
                source.created_at
            )

    };

}


/* =========================================================
   19. ADD / UPDATE MESSAGE
   ========================================================= */

function addOrUpdateMessage(
    rawMessage,
    scroll = true
) {

    const message =
        normalizeMessage(
            rawMessage
        );


    if (!message) {
        return;
    }


    /*
     * Only display messages belonging
     * to current conversation.
     */

    if (
        selectedUserId &&
        message.sender_id !==
            Number(selectedUserId) &&
        message.receiver_id !==
            Number(selectedUserId)
    ) {

        return;

    }


    /*
     * If this message already exists,
     * update its status instead of
     * creating a duplicate.
     */

    if (
        message.id &&
        messageElements.has(
            message.id
        )
    ) {

        updateMessageElement(
            message
        );

        return;

    }


    clearEmptyMessageState();


    const element =
        createMessageElement(
            message
        );


    if (!element) {
        return;
    }


    if (
        message.id
    ) {

        messageElements.set(
            message.id,
            element
        );

    }


    if (
        elements.messageContainer
    ) {

        elements.messageContainer.appendChild(
            element
        );

    }


    updateContactPreview(
        message.sender_id === CURRENT_USER_ID
            ? message.receiver_id
            : message.sender_id,
        message.content ||
        (
            message.message_type ===
            "image"
                ? "📷 Image"
                : message.message_type ===
                  "video"
                    ? "🎥 Video"
                    : ""
        ),
        message.time
    );


    if (scroll) {

        scrollMessagesToBottom();

    }

}


/* =========================================================
   20. CREATE MESSAGE ELEMENT
   ========================================================= */

function createMessageElement(
    message
) {

    const isSent =
        Number(message.sender_id) ===
        Number(CURRENT_USER_ID);


    const row =
        document.createElement(
            "div"
        );

    row.className =
        `message-row ${
            isSent
                ? "sent"
                : "received"
        }`;


    if (message.id) {

        row.dataset.messageId =
            message.id;

    }


    const bubble =
        document.createElement(
            "div"
        );

    bubble.className =
        `message ${
            isSent
                ? "sent"
                : "received"
        }`;


    /* Media */
    if (
        message.media_url &&
        (
            message.message_type ===
            "image" ||
            message.media_type ===
            "image"
        )
    ) {

        const image =
            document.createElement(
                "img"
            );

        image.className =
            "message-image";

        image.src =
            message.media_url;

        image.alt =
            "Image";

        image.loading =
            "lazy";


        image.addEventListener(
            "click",
            function () {

                window.open(
                    message.media_url,
                    "_blank"
                );

            }
        );


        bubble.appendChild(
            image
        );

    }


    /* Video */
    else if (
        message.media_url &&
        (
            message.message_type ===
            "video" ||
            message.media_type ===
            "video"
        )
    ) {

        const video =
            document.createElement(
                "video"
            );

        video.className =
            "message-video";

        video.src =
            message.media_url;

        video.controls =
            true;

        video.preload =
            "metadata";


        bubble.appendChild(
            video
        );

    }


    /* Text */
    if (
        message.content &&
        message.content.trim()
    ) {

        const text =
            document.createElement(
                "div"
            );

        text.className =
            "message-text";

        text.textContent =
            message.content;


        bubble.appendChild(
            text
        );

    }


    /* If media has no text */
    if (
        !bubble.children.length
    ) {

        const text =
            document.createElement(
                "div"
            );

        text.className =
            "message-text";

        text.textContent =
            "(Media)";


        bubble.appendChild(
            text
        );

    }


    /* Meta */
    const meta =
        document.createElement(
            "div"
        );

    meta.className =
        "message-meta";


    const time =
        document.createElement(
            "span"
        );

    time.className =
        "message-time";

    time.textContent =
        message.time ||
        formatMessageTime(
            message.created_at
        );


    meta.appendChild(
        time
    );


    /* Status only for sent messages */
    if (isSent) {

        const status =
            document.createElement(
                "span"
            );

        status.className =
            getStatusClass(
                message
            );

        status.dataset.status =
            "true";

        status.textContent =
            getStatusIcon(
                message
            );


        meta.appendChild(
            status
        );

    }


    bubble.appendChild(
        meta
    );


    row.appendChild(
        bubble
    );


    return row;

}


/* =========================================================
   21. MESSAGE STATUS
   ========================================================= */

function getStatusClass(
    message
) {

    if (message.is_read) {

        return "message-status read";

    }


    if (message.is_delivered) {

        return "message-status delivered";

    }


    return "message-status sent";

}


function getStatusIcon(
    message
) {

    if (message.is_read) {

        return "✓✓";

    }


    if (message.is_delivered) {

        return "✓✓";

    }


    return "✓";

}


/* =========================================================
   22. UPDATE MESSAGE ELEMENT
   ========================================================= */

function updateMessageElement(
    message
) {

    if (!message.id) {
        return;
    }


    const element =
        messageElements.get(
            message.id
        );


    if (!element) {
        return;
    }


    const status =
        element.querySelector(
            '[data-status="true"]'
        );


    if (!status) {
        return;
    }


    status.className =
        getStatusClass(
            message
        );


    status.textContent =
        getStatusIcon(
            message
        );

}


/* =========================================================
   23. MARK READ
   ========================================================= */

async function markCurrentChatRead() {

    if (!selectedUserId) {
        return;
    }


    /*
     * HTTP API
     */
    try {

        await apiRequest(
            CONFIG.markReadUrl,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    sender_id:
                        Number(
                            selectedUserId
                        )
                })
            }
        );

    } catch (error) {

        console.warn(
            "HTTP mark read failed:",
            error
        );

    }


    /*
     * WebSocket notification
     */
    sendSocketMessage({

        type: "mark_read",

        sender_id:
            Number(selectedUserId)

    });


    /*
     * Clear local unread count
     */
    const contact =
        contactMap.get(
            Number(selectedUserId)
        );


    if (contact) {

        contact.unread_count =
            0;

    }


    renderContacts();

}


/* =========================================================
   24. SEND TEXT MESSAGE
   ========================================================= */

async function handleMessageSubmit(
    event
) {

    if (event) {
        event.preventDefault();
    }


    if (isSendingMessage) {
        return;
    }


    if (!selectedUserId) {

        showToast(
            "Select a contact first.",
            "error"
        );

        return;
    }


    const input =
        elements.messageInput;


    if (!input) {
        return;
    }


    const text =
        input.value.trim();


    if (!text) {
        return;
    }


    isSendingMessage = true;


    try {

        /*
         * Preferred:
         * WebSocket
         */

        if (
            socket &&
            socket.readyState ===
            WebSocket.OPEN
        ) {

            const sent =
                sendSocketMessage({

                    type: "chat_message",

                    receiver_id:
                        Number(
                            selectedUserId
                        ),

                    message:
                        text

                });


            if (sent) {

                input.value = "";

                autoResizeMessageInput();

                return;

            }

        }


        /*
         * HTTP fallback
         *
         * This is used only when
         * WebSocket is unavailable.
         */

        const formData =
            new FormData();

        formData.append(
            "receiver_id",
            String(
                selectedUserId
            )
        );

        formData.append(
            "message",
            text
        );


        const data =
            await apiRequest(
                CONFIG.sendMessageUrl,
                {
                    method: "POST",
                    body: formData
                }
            );


        if (!data.success) {

            throw new Error(
                data.message ||
                "Message could not be sent."
            );

        }


        /*
         * IMPORTANT:
         * Render sender message immediately.
         */

        if (data.message) {

            addOrUpdateMessage(
                data.message
            );

        }


        input.value = "";

        autoResizeMessageInput();


    } catch (error) {

        console.error(
            "Send message error:",
            error
        );

        showToast(
            error.message ||
            "Message failed.",
            "error"
        );

    } finally {

        isSendingMessage = false;

    }

}


/* =========================================================
   25. MEDIA UPLOAD
   ========================================================= */

async function handleMediaUpload(
    event
) {

    const file =
        event.target.files &&
        event.target.files[0];


    if (!file) {
        return;
    }


    /*
     * Reset input so same file
     * can be selected again.
     */

    event.target.value = "";


    if (!selectedUserId) {

        showToast(
            "Select a contact first.",
            "error"
        );

        return;
    }


    const maxSize =
        50 * 1024 * 1024;


    if (file.size > maxSize) {

        showToast(
            "Maximum file size is 50 MB.",
            "error"
        );

        return;
    }


    const isImage =
        file.type.startsWith(
            "image/"
        );


    const isVideo =
        file.type.startsWith(
            "video/"
        );


    if (!isImage && !isVideo) {

        showToast(
            "Only image and video files are allowed.",
            "error"
        );

        return;
    }


    try {

        showToast(
            "Uploading media...",
            "info"
        );


        const formData =
            new FormData();


        /*
         * IMPORTANT:
         * Backend expects "file".
         */

        formData.append(
            "file",
            file
        );


        formData.append(
            "receiver_id",
            String(
                selectedUserId
            )
        );


        const data =
            await apiRequest(
                CONFIG.uploadMediaUrl,
                {
                    method: "POST",
                    body: formData
                }
            );


        if (!data.success) {

            throw new Error(
                data.message ||
                "Media upload failed."
            );

        }


        /*
         * Show immediately to sender.
         */

        addOrUpdateMessage(
            data.message || data
        );


        /*
         * Notify receiver through WebSocket.
         */

        if (
            data.message_id &&
            socket &&
            socket.readyState ===
            WebSocket.OPEN
        ) {

            sendSocketMessage({

                type: "media_message",

                receiver_id:
                    Number(
                        selectedUserId
                    ),

                message_id:
                    Number(
                        data.message_id
                    )

            });

        }


        showToast(
            "Media sent.",
            "success"
        );


    } catch (error) {

        console.error(
            "Media upload error:",
            error
        );

        showToast(
            error.message ||
            "Media upload failed.",
            "error"
        );

    }

}


/* =========================================================
   26. CONTACT PREVIEW
   ========================================================= */

function updateContactPreview(
    userId,
    text,
    time
) {

    const contact =
        contactMap.get(
            Number(userId)
        );


    if (!contact) {
        return;
    }


    contact.last_message =
        text || "";


    contact.last_time =
        time ||
        formatMessageTime(
            new Date()
        );


    renderContacts(
        elements.contactSearch
            ? elements.contactSearch.value.trim()
            : ""
    );

}


/* =========================================================
   27. WEBSOCKET CONNECT
   ========================================================= */

function connectWebSocket() {

    if (
        !CONFIG.websocketUrl
    ) {

        console.error(
            "WebSocket URL is missing."
        );

        return;

    }


    if (
        socket &&
        (
            socket.readyState ===
            WebSocket.OPEN ||
            socket.readyState ===
            WebSocket.CONNECTING
        )
    ) {

        return;

    }


    try {

        socket =
            new WebSocket(
                CONFIG.websocketUrl
            );

    } catch (error) {

        console.error(
            "WebSocket creation error:",
            error
        );

        scheduleWebSocketReconnect();

        return;

    }


    socket.addEventListener(
        "open",
        handleSocketOpen
    );


    socket.addEventListener(
        "message",
        handleSocketMessage
    );


    socket.addEventListener(
        "close",
        handleSocketClose
    );


    socket.addEventListener(
        "error",
        handleSocketError
    );

}


/* =========================================================
   28. SOCKET OPEN
   ========================================================= */

function handleSocketOpen() {

    console.log(
        "WebSocket connected."
    );


    socketReconnectAttempts = 0;


    if (!socketWasConnected) {

        socketWasConnected = true;

    }


    /*
     * Refresh contacts/presence after
     * WebSocket becomes available.
     */

    if (selectedUserId) {

        loadPresence(
            selectedUserId
        );

    }

}


/* =========================================================
   29. SOCKET CLOSE
   ========================================================= */

function handleSocketClose() {

    console.warn(
        "WebSocket disconnected."
    );


    scheduleWebSocketReconnect();

}


/* =========================================================
   30. SOCKET ERROR
   ========================================================= */

function handleSocketError(
    error
) {

    console.error(
        "WebSocket error:",
        error
    );

}


/* =========================================================
   31. SOCKET RECONNECT
   ========================================================= */

function scheduleWebSocketReconnect() {

    if (
        socketReconnectTimer
    ) {

        return;

    }


    socketReconnectAttempts++;


    const delay =
        Math.min(
            1000 *
            Math.pow(
                2,
                socketReconnectAttempts - 1
            ),
            10000
        );


    socketReconnectTimer =
        setTimeout(
            function () {

                socketReconnectTimer =
                    null;

                connectWebSocket();

            },
            delay
        );

}


/* =========================================================
   32. SOCKET SEND
   ========================================================= */

function sendSocketMessage(
    data
) {

    if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ) {

        return false;

    }


    try {

        socket.send(
            JSON.stringify(data)
        );

        return true;

    } catch (error) {

        console.error(
            "Socket send error:",
            error
        );

        return false;

    }

}


/* =========================================================
   33. SOCKET MESSAGE HANDLER
   ========================================================= */

async function handleSocketMessage(
    event
) {

    let data;


    try {

        data =
            JSON.parse(
                event.data
            );

    } catch (error) {

        console.error(
            "Invalid WebSocket JSON:",
            event.data
        );

        return;

    }


    console.log(
        "WebSocket:",
        data
    );


    const type =
        data.type;


    switch (type) {


        /* =====================================================
           MESSAGE SENT
           ===================================================== */

        case "message_sent": {

            const message =
                normalizeMessage(
                    data.message || data
                );


            if (message) {

                /*
                 * THIS FIXES:
                 * Sender not seeing own message.
                 */

                addOrUpdateMessage(
                    message
                );

            }

            break;

        }


        /* =====================================================
           INCOMING CHAT MESSAGE
           ===================================================== */

        case "chat_message": {

            const message =
                normalizeMessage(
                    data.message || data
                );


            if (!message) {
                break;
            }


            const senderId =
                Number(
                    message.sender_id ||
                    data.sender_id ||
                    0
                );


            /*
             * Receiver acknowledges delivery.
             */

            if (
                message.id &&
                senderId
            ) {

                sendSocketMessage({

                    type:
                        "message_delivered",

                    sender_id:
                        senderId,

                    message_id:
                        Number(
                            message.id
                        )

                });

            }


            /*
             * If this chat is open,
             * display immediately.
             */

            if (
                selectedUserId &&
                Number(
                    selectedUserId
                ) === senderId
            ) {

                addOrUpdateMessage(
                    message
                );


                await markCurrentChatRead();

            }

            else {

                /*
                 * Message belongs to
                 * another contact.
                 */

                increaseUnreadCount(
                    senderId
                );


                updateContactPreview(
                    senderId,
                    message.content ||
                    "New message",
                    message.time
                );


                showToast(
                    `New message from ${
                        message.sender ||
                        getContactDisplayName(
                            contactMap.get(
                                senderId
                            )
                        )
                    }`,
                    "info"
                );

            }


            await loadNotifications();

            break;

        }


        /* =====================================================
           DELIVERY ACK REQUEST
           ===================================================== */

        case "request_delivery_ack": {

            const messageId =
                Number(
                    data.message_id ||
                    data.id ||
                    0
                );


            const senderId =
                Number(
                    data.sender_id ||
                    data.from_user_id ||
                    0
                );


            if (
                messageId &&
                senderId
            ) {

                sendSocketMessage({

                    type:
                        "message_delivered",

                    sender_id:
                        senderId,

                    message_id:
                        messageId

                });

            }

            break;

        }


        /* =====================================================
           MESSAGE DELIVERED
           ===================================================== */

        case "message_delivered": {

            const messageId =
                Number(
                    data.message_id ||
                    data.id ||
                    0
                );


            updateMessageStatus(
                messageId,
                {
                    is_delivered: true
                }
            );

            break;

        }


        /* =====================================================
           MESSAGES READ
           ===================================================== */

        case "messages_read": {

            const messageIds =
                Array.isArray(
                    data.message_ids
                )
                    ? data.message_ids
                    : null;


            if (messageIds) {

                messageIds.forEach(
                    function (id) {

                        updateMessageStatus(
                            Number(id),
                            {
                                is_delivered: true,
                                is_read: true
                            }
                        );

                    }
                );

            }

            else {

                /*
                 * Backend may send only
                 * sender_id.
                 *
                 * Mark current sent messages
                 * as read.
                 */

                markCurrentSentMessagesRead();

            }


            break;

        }


        /* =====================================================
           MEDIA MESSAGE
           ===================================================== */

        case "media_message": {

            /*
             * Depending on consumer implementation,
             * media_message may contain the complete
             * message or only message_id.
             */

            if (
                data.message &&
                typeof data.message ===
                "object"
            ) {

                addOrUpdateMessage(
                    data.message
                );

            }

            else if (
                data.message_id
            ) {

                /*
                 * Receiver can refresh current
                 * conversation to obtain media.
                 */

                if (
                    selectedUserId
                ) {

                    await loadMessages(
                        selectedUserId
                    );

                }

            }

            break;

        }


        /* =====================================================
           VOICE CALL OFFER
           ===================================================== */

        case "call_offer": {

            await handleIncomingCall(
                data
            );

            break;

        }


        /* =====================================================
           VOICE CALL ANSWER
           ===================================================== */

        case "call_answer": {

            await handleCallAnswer(
                data
            );

            break;

        }


        /* =====================================================
           ICE CANDIDATE
           ===================================================== */

        case "ice_candidate": {

            await handleIceCandidate(
                data
            );

            break;

        }


        /* =====================================================
           CALL REJECTED
           ===================================================== */

        case "call_rejected": {

            showToast(
                "Call rejected.",
                "error"
            );


            updateCallStatus(
                "Call rejected"
            );


            setTimeout(
                function () {

                    cleanupCall();

                },
                1000
            );

            break;

        }


        /* =====================================================
           CALL ENDED
           ===================================================== */

        case "call_ended": {

            updateCallStatus(
                "Call ended"
            );


            setTimeout(
                function () {

                    cleanupCall();

                },
                500
            );

            break;

        }


        default:

            console.log(
                "Unhandled WebSocket event:",
                type,
                data
            );

            break;

    }

}


/* =========================================================
   34. INCREASE UNREAD COUNT
   ========================================================= */

function increaseUnreadCount(
    userId
) {

    const contact =
        contactMap.get(
            Number(userId)
        );


    if (!contact) {
        return;
    }


    contact.unread_count =
        Number(
            contact.unread_count || 0
        ) + 1;


    renderContacts();

}


/* =========================================================
   35. UPDATE MESSAGE STATUS
   ========================================================= */

function updateMessageStatus(
    messageId,
    status
) {

    if (!messageId) {
        return;
    }


    const element =
        messageElements.get(
            Number(messageId)
        );


    if (!element) {
        return;
    }


    const statusElement =
        element.querySelector(
            '[data-status="true"]'
        );


    if (!statusElement) {
        return;
    }


    if (status.is_read) {

        statusElement.className =
            "message-status read";

        statusElement.textContent =
            "✓✓";

    }

    else if (status.is_delivered) {

        statusElement.className =
            "message-status delivered";

        statusElement.textContent =
            "✓✓";

    }

}


/* =========================================================
   36. MARK ALL CURRENT SENT MESSAGES READ
   ========================================================= */

function markCurrentSentMessagesRead() {

    messageElements.forEach(
        function (element) {

            const status =
                element.querySelector(
                    '[data-status="true"]'
                );


            if (!status) {
                return;
            }


            status.className =
                "message-status read";

            status.textContent =
                "✓✓";

        }
    );

}


/* =========================================================
   37. CLEAR MESSAGES
   ========================================================= */

function clearMessages() {

    messageElements.clear();


    if (
        !elements.messageContainer
    ) {

        return;

    }


    elements.messageContainer.innerHTML =
        "";


    if (elements.messageLoading) {

        elements.messageContainer.appendChild(
            elements.messageLoading
        );

    }

}


/* =========================================================
   38. EMPTY MESSAGE STATE
   ========================================================= */

function renderEmptyMessages(
    text = "No messages yet"
) {

    if (
        !elements.messageContainer
    ) {

        return;

    }


    clearEmptyMessageState();


    const empty =
        document.createElement(
            "div"
        );

    empty.className =
        "message-empty";


    empty.textContent =
        text;


    elements.messageContainer.appendChild(
        empty
    );

}


function clearEmptyMessageState() {

    if (
        !elements.messageContainer
    ) {

        return;

    }


    const empty =
        elements.messageContainer.querySelector(
            ".message-empty"
        );


    if (empty) {

        empty.remove();

    }


    const oldEmpty =
        elements.messageContainer.querySelector(
            ".empty-contacts"
        );


    if (oldEmpty) {

        oldEmpty.remove();

    }

}


/* =========================================================
   39. MESSAGE LOADING
   ========================================================= */

function showMessageLoading(
    show
) {

    if (!elements.messageLoading) {
        return;
    }


    if (show) {

        elements.messageLoading.classList.remove(
            "hidden"
        );

    }

    else {

        elements.messageLoading.classList.add(
            "hidden"
        );

    }

}


/* =========================================================
   40. CONTACT LOADING
   ========================================================= */

function showContactLoading(
    show
) {

    if (!elements.contactLoading) {
        return;
    }


    if (show) {

        elements.contactLoading.classList.remove(
            "hidden"
        );

    }

    else {

        elements.contactLoading.classList.add(
            "hidden"
        );

    }

}


/* =========================================================
   41. CONTACT ERROR
   ========================================================= */

function renderContactError(
    text
) {

    if (
        !elements.contactList
    ) {

        return;

    }


    elements.contactList.innerHTML =
        "";


    const error =
        document.createElement(
            "div"
        );

    error.className =
        "contact-empty error";

    error.textContent =
        text;


    elements.contactList.appendChild(
        error
    );

}


/* =========================================================
   42. SCROLL MESSAGES
   ========================================================= */

function scrollMessagesToBottom() {

    if (
        !elements.messageContainer
    ) {

        return;

    }


    requestAnimationFrame(
        function () {

            elements.messageContainer.scrollTop =
                elements.messageContainer.scrollHeight;

        }
    );

}


/* =========================================================
   43. PRESENCE
   ========================================================= */

async function loadPresence(
    userId
) {

    if (!userId) {
        return;
    }


    try {

        const url =
            `${CONFIG.searchUsersUrl
                ? `/api/users/${userId}/presence/`
                : `/api/users/${userId}/presence/`
            }`;


        const data =
            await apiRequest(
                url,
                {
                    method: "GET"
                }
            );


        const contact =
            contactMap.get(
                Number(userId)
            );


        if (contact) {

            contact.is_online =
                Boolean(
                    data.is_online
                );

        }


        updatePresenceUI(
            data
        );


        renderContacts();


    } catch (error) {

        console.warn(
            "Presence error:",
            error
        );

    }

}


function updatePresenceUI(
    data
) {

    if (
        !elements.chatStatus
    ) {

        return;

    }


    if (data.is_online) {

        elements.chatStatus.textContent =
            "online";

        return;

    }


    if (data.last_seen) {

        elements.chatStatus.textContent =
            `last seen ${formatLastSeen(
                data.last_seen
            )}`;

    }

    else {

        elements.chatStatus.textContent =
            "offline";

    }

}


/* =========================================================
   44. PRESENCE POLLING
   ========================================================= */

function startPresencePolling() {

    stopPresencePolling();


    if (!selectedUserId) {
        return;
    }


    presenceTimer =
        setInterval(
            function () {

                if (selectedUserId) {

                    loadPresence(
                        selectedUserId
                    );

                }

            },
            10000
        );

}


function stopPresencePolling() {

    if (presenceTimer) {

        clearInterval(
            presenceTimer
        );

        presenceTimer = null;

    }

}

async function loadNotifications() {

    try {

        const data =
            await apiRequest(
                CONFIG.notificationsUrl,
                {
                    method: "GET"
                }
            );


        updateNotificationCount(
            Number(
                data.unread_count || 0
            )
        );


        renderNotifications(
            data.notifications || []
        );


    } catch (error) {

        console.warn(
            "Notifications error:",
            error
        );

    }

}


function updateNotificationCount(
    count
) {

    if (
        !elements.notificationCount
    ) {

        return;

    }


    if (count > 0) {

        elements.notificationCount.textContent =
            count > 99
                ? "99+"
                : String(count);

        elements.notificationCount.classList.remove(
            "hidden"
        );

    }

    else {

        elements.notificationCount.textContent =
            "";

        elements.notificationCount.classList.add(
            "hidden"
        );

    }

}


function renderNotifications(
    notifications
) {

    if (
        !elements.notificationList
    ) {

        return;

    }


    elements.notificationList.innerHTML =
        "";


    if (
        !notifications ||
        notifications.length === 0
    ) {

        const empty =
            document.createElement(
                "div"
            );

        empty.className =
            "notification-empty";

        empty.textContent =
            "No notifications";


        elements.notificationList.appendChild(
            empty
        );

        return;

    }


    notifications.forEach(
        function (notification) {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "notification-item";


            if (
                !notification.is_read
            ) {

                item.classList.add(
                    "unread"
                );

            }


            const title =
                document.createElement(
                    "div"
                );

            title.className =
                "notification-title";

            title.textContent =
                notification.sender ||
                "Notification";


            const message =
                document.createElement(
                    "div"
                );

            message.className =
                "notification-message";

            message.textContent =
                notification.message ||
                "";


            const time =
                document.createElement(
                    "div"
                );

            time.className =
                "notification-time";

            time.textContent =
                notification.time ||
                formatMessageTime(
                    notification.created_at
                );


            item.appendChild(
                title
            );

            item.appendChild(
                message
            );

            item.appendChild(
                time
            );


            elements.notificationList.appendChild(
                item
            );

        }
    );

}




const RTC_CONFIG = {

    iceServers: [

        {
            urls:
                "stun:stun.l.google.com:19302"
        }

    ]

};



function createPeerConnection(
    userId
) {

    currentCallUserId =
        Number(userId);


    peerConnection =
        new RTCPeerConnection(
            RTC_CONFIG
        );


    /*
     * ICE candidate
     */

    peerConnection.onicecandidate =
        function (event) {

            if (
                !event.candidate
            ) {

                return;

            }


            sendSocketMessage({

                type:
                    "ice_candidate",

                receiver_id:
                    Number(
                        currentCallUserId
                    ),

                candidate:
                    event.candidate

            });

        };


    /*
     * Remote audio
     */

    peerConnection.ontrack =
        function (event) {

            console.log(
                "Remote audio received."
            );


            if (
                elements.remoteAudio
            ) {

                elements.remoteAudio.srcObject =
                    event.streams[0];


                elements.remoteAudio.play()
                    .catch(
                        function (error) {

                            console.warn(
                                "Audio autoplay blocked:",
                                error
                            );

                        }
                    );

            }

        };


    /*
     * Connection state
     */

    peerConnection.onconnectionstatechange =
        function () {

            if (!peerConnection) {
                return;
            }


            const state =
                peerConnection.connectionState;


            console.log(
                "WebRTC connection state:",
                state
            );


            if (
                state === "connected"
            ) {

                callStarted = true;

                updateCallStatus(
                    "Connected"
                );

            }


            if (
                state === "connecting"
            ) {

                updateCallStatus(
                    "Connecting..."
                );

            }


            if (
                state === "disconnected"
            ) {

                updateCallStatus(
                    "Disconnected"
                );

            }


            if (
                state === "failed"
            ) {

                updateCallStatus(
                    "Connection failed"
                );


                showToast(
                    "Voice call connection failed.",
                    "error"
                );

            }

        };


    /*
     * ICE connection state
     */

    peerConnection.oniceconnectionstatechange =
        function () {

            if (!peerConnection) {
                return;
            }


            console.log(
                "ICE state:",
                peerConnection.iceConnectionState
            );

        };


    return peerConnection;

}


async function startVoiceCall() {

    if (!selectedUserId) {

        showToast(
            "Select a contact first.",
            "error"
        );

        return;

    }


    if (
        !socket ||
        socket.readyState !==
        WebSocket.OPEN
    ) {

        showToast(
            "Connecting to server...",
            "error"
        );

        connectWebSocket();

        return;

    }


    try {

        currentCallUserId =
            Number(
                selectedUserId
            );


        currentCallUsername =
            getContactDisplayName(
                selectedContact
            );


        /*
         * Get microphone
         */

        localStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true,
                    video: false
                }
            );


        /*
         * Create peer connection
         */

        createPeerConnection(
            currentCallUserId
        );


        /*
         * Add microphone track
         */

        localStream
            .getTracks()
            .forEach(
                function (track) {

                    peerConnection.addTrack(
                        track,
                        localStream
                    );

                }
            );


        /*
         * Create offer
         */

        const offer =
            await peerConnection.createOffer();


        await peerConnection.setLocalDescription(
            offer
        );


        /*
         * Open call UI
         */

        openCallModal(
            currentCallUsername
        );


        updateCallStatus(
            "Calling..."
        );


        /*
         * Send offer
         */

        const sent =
            sendSocketMessage({

                type:
                    "call_offer",

                receiver_id:
                    Number(
                        currentCallUserId
                    ),

                offer:
                    offer

            });


        if (!sent) {

            throw new Error(
                "Unable to send call request."
            );

        }


    } catch (error) {

        console.error(
            "Start call error:",
            error
        );


        showToast(
            "Unable to start voice call. Please allow microphone access.",
            "error"
        );


        cleanupCall();

    }

}



async function handleIncomingCall(
    data
) {

    try {

        incomingCallerId =
            Number(
                data.caller_id ||
                data.sender_id ||
                data.user_id ||
                0
            );


        incomingCallerName =
            data.caller_username ||
            data.sender ||
            data.username ||
            getContactDisplayName(
                contactMap.get(
                    incomingCallerId
                )
            ) ||
            "Unknown";


        incomingOffer =
            data.offer;


        if (
            !incomingCallerId ||
            !incomingOffer
        ) {

            console.error(
                "Invalid incoming call data:",
                data
            );

            return;

        }


        currentCallUserId =
            incomingCallerId;


        currentCallUsername =
            incomingCallerName;


        /*
         * Show incoming call modal.
         */

        if (
            elements.incomingCallerName
        ) {

            elements.incomingCallerName.textContent =
                incomingCallerName;

        }


        if (
            elements.incomingCallAvatar
        ) {

            elements.incomingCallAvatar.textContent =
                getInitials(
                    incomingCallerName
                );

        }


        openModal(
            "incomingCallModal"
        );


    } catch (error) {

        console.error(
            "Incoming call error:",
            error
        );

    }

}



async function acceptIncomingCall() {

    if (
        !incomingCallerId ||
        !incomingOffer
    ) {

        return;

    }


    try {

        closeModal(
            "incomingCallModal"
        );


        currentCallUserId =
            Number(
                incomingCallerId
            );


        currentCallUsername =
            incomingCallerName ||
            "Voice Call";


        /*
         * Get microphone
         */

        localStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true,
                    video: false
                }
            );


        /*
         * Create peer
         */

        createPeerConnection(
            currentCallUserId
        );


        /*
         * Add microphone
         */

        localStream
            .getTracks()
            .forEach(
                function (track) {

                    peerConnection.addTrack(
                        track,
                        localStream
                    );

                }
            );


        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                incomingOffer
            )
        );


        await flushPendingIceCandidates();


        /*
         * Create answer
         */

        const answer =
            await peerConnection.createAnswer();


        await peerConnection.setLocalDescription(
            answer
        );


        /*
         * Open call modal
         */

        openCallModal(
            currentCallUsername
        );


        updateCallStatus(
            "Connecting..."
        );


        /*
         * Send answer
         */

        sendSocketMessage({

            type:
                "call_answer",

            receiver_id:
                Number(
                    currentCallUserId
                ),

            answer:
                answer

        });


        incomingOffer = null;


    } catch (error) {

        console.error(
            "Accept call error:",
            error
        );


        showToast(
            "Unable to accept call.",
            "error"
        );


        cleanupCall();

    }

}


async function handleCallAnswer(
    data
) {

    try {

        if (
            !peerConnection
        ) {

            console.warn(
                "No peer connection for answer."
            );

            return;

        }


        const answer =
            data.answer;


        if (!answer) {

            console.error(
                "Answer not found."
            );

            return;

        }


        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                answer
            )
        );


        /*
         * Add early ICE candidates.
         */

        await flushPendingIceCandidates();


        updateCallStatus(
            "Connecting..."
        );


    } catch (error) {

        console.error(
            "Call answer error:",
            error
        );


        showToast(
            "Unable to establish voice call.",
            "error"
        );

    }

}


async function handleIceCandidate(
    data
) {

    if (
        !data.candidate
    ) {

        return;

    }


    if (
        !peerConnection ||
        !peerConnection.remoteDescription
    ) {

        pendingIceCandidates.push(
            data.candidate
        );

        return;

    }


    try {

        await peerConnection.addIceCandidate(
            new RTCIceCandidate(
                data.candidate
            )
        );


    } catch (error) {

        console.error(
            "ICE candidate error:",
            error
        );

    }

}


async function flushPendingIceCandidates() {

    if (
        !peerConnection
    ) {

        return;

    }


    if (
        !peerConnection.remoteDescription
    ) {

        return;

    }


    const candidates =
        [...pendingIceCandidates];


    pendingIceCandidates = [];


    for (
        const candidate
        of candidates
    ) {

        try {

            await peerConnection.addIceCandidate(
                new RTCIceCandidate(
                    candidate
                )
            );


        } catch (error) {

            console.error(
                "Pending ICE error:",
                error
            );

        }

    }

}



function rejectIncomingCall() {

    if (
        currentCallUserId
    ) {

        sendSocketMessage({

            type:
                "call_rejected",

            receiver_id:
                Number(
                    currentCallUserId
                )

        });

    }


    closeModal(
        "incomingCallModal"
    );


    incomingOffer = null;
    incomingCallerId = null;


    currentCallUserId = null;


    showToast(
        "Call rejected.",
        "info"
    );

}



function endCurrentCall() {

    if (
        currentCallUserId
    ) {

        sendSocketMessage({

            type:
                "call_ended",

            receiver_id:
                Number(
                    currentCallUserId
                )

        });

    }


    cleanupCall();

}


function cleanupCall(
    closeSocket = true
) {

    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                function (track) {

                    track.stop();

                }
            );


        localStream = null;

    }


    if (peerConnection) {

        try {

            peerConnection.ontrack =
                null;

            peerConnection.onicecandidate =
                null;

            peerConnection.close();

        } catch (error) {

            console.warn(
                error
            );

        }


        peerConnection =
            null;

    }


    pendingIceCandidates = [];


    incomingOffer = null;
    incomingCallerId = null;


    currentCallUserId = null;
    currentCallUsername = "";


    callStarted = false;


    if (
        elements.remoteAudio
    ) {

        elements.remoteAudio.srcObject =
            null;

    }


    closeModal(
        "callModal"
    );

    closeModal(
        "incomingCallModal"
    );

}



function openCallModal(
    username
) {

    if (
        elements.callUserName
    ) {

        elements.callUserName.textContent =
            username ||
            "Voice Call";

    }


    if (
        elements.callAvatar
    ) {

        elements.callAvatar.textContent =
            getInitials(
                username ||
                "Voice Call"
            );

    }


    openModal(
        "callModal"
    );

}


function updateCallStatus(
    text
) {

    if (
        elements.callStatus
    ) {

        elements.callStatus.textContent =
            text;

    }

}


function openModal(
    modalId
) {

    const modal =
        $(modalId);


    if (!modal) {
        return;
    }


    modal.classList.remove(
        "hidden"
    );

}


function closeModal(
    modalId
) {

    const modal =
        $(modalId);


    if (!modal) {
        return;
    }


    modal.classList.add(
        "hidden"
    );

}


function showToast(
    message,
    type = "info"
) {

    if (
        !elements.toastContainer
    ) {

        console.log(
            message
        );

        return;

    }


    const toast =
        document.createElement(
            "div"
        );


    toast.className =
        `app-toast ${type}`;


    toast.textContent =
        message;


    elements.toastContainer.appendChild(
        toast
    );


    setTimeout(
        function () {

            toast.classList.add(
                "show"
            );

        },
        10
    );


    setTimeout(
        function () {

            toast.classList.remove(
                "show"
            );


            setTimeout(
                function () {

                    toast.remove();

                },
                300
            );

        },
        3000
    );

}


function showContactMessage(
    message,
    type = "info"
) {

    if (
        !elements.contactMessage
    ) {

        showToast(
            message,
            type
        );

        return;

    }


    elements.contactMessage.textContent =
        message;


    elements.contactMessage.className =
        `form-message ${type}`;

}



function setButtonLoading(
    button,
    loading
) {

    if (!button) {
        return;
    }


    if (loading) {

        button.dataset.originalText =
            button.textContent;

        button.textContent =
            "Please wait...";

        button.disabled =
            true;

    }

    else {

        button.textContent =
            button.dataset.originalText ||
            "Add Contact";

        button.disabled =
            false;

    }

}



function formatMessageTime(
    value
) {

    if (!value) {
        return "";
    }


    let date;


    if (
        value instanceof Date
    ) {

        date = value;

    }

    else {

        const stringValue =
            String(value);


        if (
            /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/
                .test(stringValue)
        ) {

            date =
                new Date(
                    stringValue.replace(
                        " ",
                        "T"
                    )
                );

        }

        else {

            date =
                new Date(
                    stringValue
                );

        }

    }


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "";

    }


    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


function formatLastSeen(
    value
) {

    if (!value) {
        return "";
    }


    const date =
        new Date(
            String(value).replace(
                " ",
                "T"
            )
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return String(value);

    }


    const now =
        new Date();


    const diff =
        now.getTime() -
        date.getTime();


    const oneMinute =
        60 * 1000;


    const oneHour =
        60 * oneMinute;


    const oneDay =
        24 * oneHour;


    if (diff < oneMinute) {

        return "just now";

    }


    if (diff < oneHour) {

        const minutes =
            Math.floor(
                diff / oneMinute
            );

        return `${minutes} min ago`;

    }


    if (diff < oneDay) {

        const hours =
            Math.floor(
                diff / oneHour
            );

        return `${hours} hr ago`;

    }


    return date.toLocaleString(
        [],
        {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}



function autoResizeMessageInput() {

    if (
        !elements.messageInput
    ) {

        return;

    }


    elements.messageInput.style.height =
        "auto";


    elements.messageInput.style.height =
        Math.min(
            elements.messageInput.scrollHeight,
            120
        ) + "px";

}



function normalizeContact(
    raw
) {

    if (!raw) {
        return null;
    }



    return {

        id:
            Number(
                raw.id
            ),

        username:
            raw.username ||
            "",

        first_name:
            raw.first_name ||
            "",

        last_name:
            raw.last_name ||
            "",

        nickname:
            raw.nickname ||
            "",

        unread_count:
            Number(
                raw.unread_count || 0
            ),

        last_message:
            raw.last_message ||
            "",

        last_time:
            raw.last_time ||
            "",

        is_online:
            Boolean(
                raw.is_online
            )

    };

}



function addContactToLocalState(
    contact
) {

    const normalized =
        normalizeContact(
            contact
        );


    if (!normalized) {
        return;
    }


    const existing =
        contactMap.get(
            normalized.id
        );


    if (existing) {

        Object.assign(
            existing,
            normalized
        );

    }

    else {

        contacts.unshift(
            normalized
        );

    }


    rebuildContactMap();

    renderContacts();

}


window.addEventListener(
    "error",
    function (event) {

        console.error(
            "JavaScript error:",
            event.error ||
            event.message
        );

    }
);




console.log(
    "WhatsApp Chat JS loaded successfully."
);