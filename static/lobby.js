/* =========================
   NICKNAME KİLİTLEME / RESET
   ========================= */
function lockNicknameIfNeeded() {
  const nicknameInput = document.getElementById("kullaniciAdi");
  const changeBtn = document.getElementById("isimDegistirButon");
  if (!nicknameInput) return;

  const stored = localStorage.getItem(NICK_KEY);
  if (stored) {
    nicknameInput.value = stored;
    nicknameInput.disabled = true;
    currentUser = stored;
    if (changeBtn) changeBtn.style.display = "inline-block";
  } else {
    nicknameInput.disabled = false;
    if (changeBtn) changeBtn.style.display = "none";
  }
}

function resetNickname() {
  if (currentRoom) {
    showMessage(
      "Uyarı",
      "Masadayken isim değiştiremezsin. Önce masadan ayrıl.",
    );
    return;
  }

  const nicknameInput = document.getElementById("kullaniciAdi");

  showConfirm(
    "Hesabı Sıfırla",
    "Bu tarayıcıdaki hesabı sıfırlayıp yeni bir isim girmek istiyor musun?",
    () => {
      try {
        localStorage.removeItem(NICK_KEY);
        localStorage.removeItem(ROOM_KEY);
      } catch (e) {}

      if (nicknameInput) {
        nicknameInput.disabled = false;
        nicknameInput.value = "";
      }
      currentUser = null;
      lockNicknameIfNeeded();
    },
  );
}

/* =========================
   ROZET / ODA KODU GÜNCELLEME
   ========================= */
function refreshRoomBadge() {
  const el = document.getElementById("masaYazi");
  if (!el) return;
  el.textContent = currentRoom ? `Masa: ${currentRoom}` : "Masa: —";
}

function resetUI() {
  currentRoom = null;
  isHost = false;
  gameStarted = false;
  playersState = [];
  myHand = [];
  isMyTurn = false;
  currentTurnPlayer = null;
  dragFromIndex = null;
  selectedIndex = null;
  currentTakeSlot = null;
  lastDiscardByMe = false;
  deckRemaining = 0;

  setScreen(SCREENS.LOBBY);

  const chat = document.getElementById("sohbetMesajlari");
  if (chat) chat.innerHTML = "";

  const istakaDiv = document.getElementById("istakaTaslari");
  if (istakaDiv) istakaDiv.innerHTML = "";

  const turnEl = document.getElementById("turnIndicator");
  if (turnEl) {
    turnEl.textContent = "Sıra: —";
    turnEl.classList.add("hidden");
  }

  document.querySelectorAll(".discard-slot").forEach((s) => {
    s.innerHTML = "";
    s.classList.remove(
      "my-discard-source",
      "my-drop-target",
      "drag-over",
      "my-turn-active",
    );
  });

  refreshRoomBadge();
}

/* =========================
   LOBİ: MASA OLUŞTUR / KATIL
   ========================= */
function createRoom() {
  const nicknameInput = document.getElementById("kullaniciAdi");
  const nickname = nicknameInput?.value.trim();
  if (!nickname) return showMessage("Uyarı", "Ad gir!");

  const stored = localStorage.getItem(NICK_KEY);
  if (stored && stored !== nickname) {
    showMessage(
      "Uyarı",
      `Bu tarayıcı zaten "${stored}" hesabı ile kayıtlı. Başka bir hesap açamazsın.`,
    );
    if (nicknameInput) nicknameInput.value = stored;
    return;
  }

  currentUser = nickname;

  try {
    if (!stored) {
      localStorage.setItem(NICK_KEY, nickname);
      if (nicknameInput) nicknameInput.disabled = true;
    }
  } catch (e) {}

  socket.emit("create_room", { nickname });
}

function joinRoom() {
  const nicknameInput = document.getElementById("kullaniciAdi");
  const nickname = nicknameInput?.value.trim();
  const code = document.getElementById("masaKodu").value.trim();
  if (!nickname || !code) return showMessage("Uyarı", "Ad ve kod gerekli!");

  const stored = localStorage.getItem(NICK_KEY);
  if (stored && stored !== nickname) {
    showMessage(
      "Uyarı",
      `Bu tarayıcı zaten "${stored}" hesabı ile kayıtlı. Başka bir hesap açamazsın.`,
    );
    if (nicknameInput) nicknameInput.value = stored;
    return;
  }

  currentUser = nickname;
  currentRoom = code;
  refreshRoomBadge();

  try {
    if (!stored) {
      localStorage.setItem(NICK_KEY, nickname);
      if (nicknameInput) nicknameInput.disabled = true;
    }
  } catch (e) {}

  socket.emit("join_room", { nickname, room: code });
}

function updateDeckCountUI() {
  const deckEl = document.getElementById("ortaDeste");
  if (!deckEl) return;

  deckEl.textContent = deckRemaining > 0 ? String(deckRemaining) : "0";
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;

/* =========================
   SOCKET: ODA / OYUN OLAYLARI
   ========================= */
socket.on("room_created", (data) => {
  currentRoom = data.room;
  isHost = true;
  playersState = [data.host];
  autoRejoinTrying = false;

  try {
    localStorage.setItem(ROOM_KEY, currentRoom);
  } catch (e) {}

  refreshRoomBadge();

  setScreen(gameStarted ? SCREENS.GAME : SCREENS.ROOM);

  if (isHost && !gameStarted) showBlock("oyunuBaslatButon");
  else hide("oyunuBaslatButon");

  const joinedEl = document.getElementById("katilanSayisiMetin");
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;
  const modeEl = document.getElementById("oyunModuEtiketi");
  if (modeEl) modeEl.innerText = data.mode ? data.mode : "Klasik";

  const oyuncuKutusu = document.getElementById("oyuncularKutusu");
  if (oyuncuKutusu) oyuncuKutusu.classList.add("hiddenToggle");
  const oyuncuTusu = document.getElementById("oyuncularTusu");
  if (oyuncuTusu) oyuncuTusu.setAttribute("aria-expanded", "false");

  renderPlayers(playersState);
  renderSeats(playersState);
  updateBotControls();
});

socket.on("room_joined", (data) => {
  console.log("ROOM_JOINED ÇALIŞTI:", data.room);

  currentRoom = data.room;
  playersState = data.players;
  isHost = currentUser === data.host;
  gameStarted = data.started;
  autoRejoinTrying = false;

  try {
    localStorage.setItem(ROOM_KEY, data.room);
  } catch (e) {}

  refreshRoomBadge();

  setScreen(gameStarted ? SCREENS.GAME : SCREENS.ROOM);

  if (isHost && !gameStarted) showBlock("oyunuBaslatButon");
  else hide("oyunuBaslatButon");

  showBlock("masadanAyrilButon");

  const oyuncuKutusu = document.getElementById("oyuncularKutusu");
  if (oyuncuKutusu) oyuncuKutusu.classList.add("hiddenToggle");
  const oyuncuTusu = document.getElementById("oyuncularTusu");
  if (oyuncuTusu) oyuncuTusu.setAttribute("aria-expanded", "false");

  const joinedEl = document.getElementById("katilanSayisiMetin");
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;

  const modeEl = document.getElementById("oyunModuEtiketi");
  if (modeEl) modeEl.innerText = data.mode ? data.mode : "Klasik";

  renderPlayers(playersState);
  renderSeats(playersState);
  updateBotControls();

  if (gameStarted) {
    socket.emit("request_hand", {
      room: currentRoom,
      player: currentUser,
    });
  }
});

socket.on("update_players", (data) => {
  playersState = data.players;
  renderPlayers(playersState);
  renderSeats(playersState);
  updateBotControls();

  const joinedEl = document.getElementById("katilanSayisiMetin");
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;
});

function addBot() {
  if (!currentRoom || !isHost || gameStarted) return;

  socket.emit("add_bot", {
    room: currentRoom,
  });
}

function removeBot(botName) {
  if (!currentRoom || !isHost || gameStarted) return;

  socket.emit("remove_bot", {
    room: currentRoom,
    bot: botName,
  });
}

function updateBotControls() {
  const box = document.getElementById("botKontrolleri");
  const addBtn = document.getElementById("botEkleButon");
  const removeBtn = document.getElementById("botKaldirButon");

  if (!box || !addBtn || !removeBtn) return;

  const botCount = playersState.filter((p) => p.startsWith("BOT_")).length;
  const canManageBots = isHost && !gameStarted && currentRoom;

  if (canManageBots) {
    box.classList.remove("hidden");
    box.style.display = "flex";
  } else {
    box.classList.add("hidden");
    box.style.display = "none";
  }

  addBtn.disabled = playersState.length >= 4;
  removeBtn.disabled = botCount <= 0;
}

window.addBot = addBot;
window.removeBot = removeBot;

/* =========================
   HATA / MESAJ / CONNECT
   ========================= */
socket.on("error", (d) => {
  const msg = d?.msg || "Bilinmeyen hata";

  if (autoRejoinTrying && msg === "Masa bulunamadı!") {
    autoRejoinTrying = false;
    try {
      localStorage.removeItem(ROOM_KEY);
    } catch (e) {}
    return;
  }

  autoRejoinTrying = false;
  showMessage("Hata", msg);
});

socket.on("message", (data) => {
  const chat = document.getElementById("sohbetMesajlari");
  if (!chat) return;

  if (data.type === "system") {
    chat.innerHTML += `<p style="opacity:.85"><em>🔔 ${data.msg}</em></p>`;
  } else {
    const user = data.user || "Anonim";
    chat.innerHTML += `<p><strong>${user}:</strong> ${data.msg}</p>`;
  }
  chat.scrollTop = chat.scrollHeight;
});

socket.on("connect", () => {
  try {
    const storedNick = localStorage.getItem(NICK_KEY);
    const storedRoom = localStorage.getItem(ROOM_KEY);

    if (storedNick && storedRoom && autoRejoinTrying) {
      currentUser = storedNick;
      currentRoom = storedRoom;

      refreshRoomBadge();

      socket.emit("join_room", {
        nickname: storedNick,
        room: storedRoom,
      });
    }
  } catch (e) {
    autoRejoinTrying = false;
  }
});

/* =========================
   DOM READY
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  lockNicknameIfNeeded();
  document.body.classList.add("chat-hidden");
  setupUIBindings();

  const storedNick = localStorage.getItem(NICK_KEY);
  const storedRoom = localStorage.getItem(ROOM_KEY);

  if (storedNick && storedRoom) {
    autoRejoinTrying = true;
    currentUser = storedNick;
    currentRoom = storedRoom;

    setScreen(SCREENS.ROOM);
    refreshRoomBadge();
  } else {
    resetUI();
  }
});

/* =========================
   UI EVENT BINDINGS
   ========================= */
function setupUIBindings() {
  const createBtn = document.getElementById("masaOlusturButon");
  if (createBtn) {
    createBtn.addEventListener("click", (e) => {
      e.preventDefault();
      createRoom();
    });
  }

  const joinBtn = document.getElementById("katilButon");
  if (joinBtn) {
    joinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      joinRoom();
    });
  }

  const nicknameInput = document.getElementById("kullaniciAdi");
  if (nicknameInput) {
    nicknameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createRoom();
      }
    });
  }

  const changeBtn = document.getElementById("isimDegistirButon");
  if (changeBtn) {
    changeBtn.addEventListener("click", resetNickname);
  }

  const roomInput = document.getElementById("masaKodu");
  if (roomInput) {
    roomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        joinRoom();
      }
    });
  }

  const copyBtn = document.getElementById("kopyalaButon");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const code =
        currentRoom ||
        (document.getElementById("masaYazi")?.textContent || "")
          .replace("Masa:", "")
          .trim();
      if (!code || code === "—")
        return showMessage("Uyarı", "Önce bir masaya gir/oluştur.");
      navigator.clipboard
        .writeText(code)
        .then(() => showMessage("Bilgi", `Masa kodu kopyalandı: ${code}`))
        .catch(() => showMessage("Hata", "Masa kodu kopyalanamadı."));
    });
  }

  const sendBtn = document.getElementById("mesajGonderButon");
  if (sendBtn) sendBtn.addEventListener("click", sendMessage);
  const msgInput = document.getElementById("mesajInput");
  if (msgInput) {
    msgInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const chatToggle = document.getElementById("sohbetToggleButon");
  if (chatToggle) {
    chatToggle.addEventListener("click", () => {
      const hidden = document.body.classList.toggle("chat-hidden");
      chatToggle.setAttribute("aria-expanded", String(!hidden));
    });
  }

  const playersToggle = document.getElementById("oyuncularTusu");
  if (playersToggle) {
    playersToggle.addEventListener("click", () => {
      const box = document.getElementById("oyuncularKutusu");
      if (!box) return;
      const isHidden = box.classList.toggle("hiddenToggle");
      if (isHidden) setTimeout(() => (box.style.display = "none"), 250);
      else box.style.display = "flex";
      playersToggle.setAttribute("aria-expanded", String(!isHidden));
    });
  }

  const startBtn = document.getElementById("oyunuBaslatButon");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      if (!isHost || gameStarted) return;
      showConfirm(
        "Oyunu Başlat",
        "Oyunu başlatmak istediğine emin misin?",
        () => {
          socket.emit("start_game", { room: currentRoom });
        },
      );
    });
  }

  const leaveBtn = document.getElementById("masadanAyrilButon");
  if (leaveBtn) {
    leaveBtn.addEventListener("click", () => {
      if (!currentRoom || !currentUser) return;

      showConfirm(
        "Masadan Ayrıl",
        "Masadan ayrılmak istediğine emin misin?",
        () => {
          socket.emit("leave_room", {
            nickname: currentUser,
            room: currentRoom,
          });

          try {
            localStorage.removeItem(ROOM_KEY);
          } catch (e) {}

          resetUI();
          lockNicknameIfNeeded();
          socket.emit("get_rooms");
        },
      );
    });
  }

  const deckEl = document.getElementById("ortaDeste");
  if (deckEl) {
    deckEl.addEventListener("click", () => {
      if (!currentRoom || !currentUser) return;

      if (!isMyTurn) {
        showMessage("Uyarı", "Şu anda sıra sende değil.");
        return;
      }

      socket.emit("draw_tile", {
        room: currentRoom,
        player: currentUser,
      });
    });
  }

  const finishBtn = document.getElementById("bitirButon");
  if (finishBtn) {
    finishBtn.addEventListener("click", () => {
      if (!currentRoom || !currentUser) return;

      if (!isMyTurn) {
        showMessage("Uyarı", "Sıra sende değilken bitiremezsin.");
        return;
      }

      showConfirm("Eli Bitir", "Bu eli bitirmek istediğine emin misin?", () => {
        socket.emit("finish_hand", {
          room: currentRoom,
          player: currentUser,
        });
      });
    });
  }

  const addBotBtn = document.getElementById("botEkleButon");
  if (addBotBtn) {
    addBotBtn.addEventListener("click", () => {
      if (!currentRoom || !isHost || gameStarted) return;
      socket.emit("add_bot", { room: currentRoom });
    });
  }

  const removeBotBtn = document.getElementById("botKaldirButon");
  if (removeBotBtn) {
    removeBotBtn.addEventListener("click", () => {
      if (!currentRoom || !isHost || gameStarted) return;

      const bot = [...playersState].reverse().find((p) => p.startsWith("BOT_"));

      if (!bot) {
        showMessage("Uyarı", "Masada kaldırılacak bot yok.");
        return;
      }

      socket.emit("remove_bot", {
        room: currentRoom,
        bot: bot,
      });
    });
  }
}

/* =========================
   OYUNCU LİSTESİ / KOLTUKLAR
   ========================= */
function renderPlayers(players) {
  const titleEl = document.querySelector("#oyuncularKutusu .kutu-baslik");
  if (titleEl) titleEl.textContent = `👥 Oyuncular (${players.length}/4)`;

  const list = document.getElementById("oyuncularListesi");
  if (!list) return;

  list.innerHTML = "";

  players.forEach((p) => {
    const li = document.createElement("li");

    if (p === players[0]) {
      li.innerHTML = `<strong>${p}</strong> <span class="kurucu-yildiz">★</span>`;
    } else {
      li.textContent = p;
    }

    if (isHost && !gameStarted && p.startsWith("BOT_")) {
      const btn = document.createElement("button");
      btn.textContent = "Kaldır";
      btn.type = "button";
      btn.style.marginLeft = "8px";
      btn.onclick = () => removeBot(p);
      li.appendChild(btn);
    }

    list.appendChild(li);
  });

  if (isHost && !gameStarted && players.length < 4) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = "+ Bot Ekle";
    btn.type = "button";
    btn.onclick = addBot;
    li.appendChild(btn);
    list.appendChild(li);
  }
}

/* =========================
   AKTİF MASALAR MODÜLÜ
   ========================= */
(function RoomsModule() {
  function $(id) {
    return document.getElementById(id);
  }

  const grid = $("masalarIzgara");
  if (!grid) return;

  function renderRooms(rooms) {
    grid.innerHTML = "";

    if (!rooms || !rooms.length) {
      return;
    }

    rooms.forEach((r) => {
      const full = r.players >= 4;
      const started = !!r.started;

      const card = document.createElement("div");
      card.className = "masa-karti";
      card.innerHTML = `
        <h4>${r.code}</h4>
        <div>Kurucu: <strong>${r.host}</strong></div>
        <div class="rozetler">
          <span class="rozet">Oyuncu: ${r.players}/4</span>
          <span class="rozet">${started ? "Başladı" : "Bekliyor"}</span>
        </div>
        <button ${started || full ? "disabled" : ""}>Katıl</button>
      `;

      const btn = card.querySelector("button");
      btn?.addEventListener("click", () => {
        const nick = document.getElementById("kullaniciAdi")?.value.trim();
        if (!nick) return showMessage("Uyarı", "Önce kullanıcı adını gir!");
        document.getElementById("masaKodu").value = r.code;
        joinRoom();
      });

      grid.appendChild(card);
    });
  }

  socket.on("rooms_list", (data) => {
    if (!currentRoom) renderRooms(data.rooms || []);
  });

  socket.on("rooms_update", (data) => {
    const lobby = document.getElementById("aktifMasalar");
    const lobbyVisible =
      lobby &&
      lobby.style.display !== "none" &&
      !lobby.classList.contains("hidden");
    if (lobbyVisible) {
      renderRooms(data.rooms || []);
    }
  });

  socket.on("connect", () => socket.emit("get_rooms"));
  $("yenileButon")?.addEventListener("click", () => socket.emit("get_rooms"));
})();
