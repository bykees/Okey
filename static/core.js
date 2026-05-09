// core.js
const socket = io();

/* ==== GLOBAL DURUM ==== */
let currentRoom = null;
let currentUser = null;
let isHost = false;
let gameStarted = false;
let playersState = [];
let autoRejoinTrying = false;

let myHand = [];
let isMyTurn = false;
let dragFromIndex = null;
let selectedIndex = null;
let currentTurnPlayer = null;
let currentTakeSlot = null;
let lastDiscardByMe = false;
let deckRemaining = 0;
let dragGhostEl = null;

let indicatorTile = null;
let okeyTile = null;

const HER_SATIR_ICIN_SLOT = 16;
const TOPLAM_SLOT_SAYISI = HER_SATIR_ICIN_SLOT * 2;

const NICK_KEY = "hadiokey_nickname";
const ROOM_KEY = "hadiokey_room";

/* =========================
   BASİT UI YARDIMCILARI
   ========================= */

const SCREENS = {
  LOBBY: "lobby",
  ROOM: "room",
  GAME: "game",
};

let currentScreen = null;

function setScreen(screen) {
  if (currentScreen === screen) return;
  currentScreen = screen;

  hide(
    "anaMenu",
    "katilAlani",
    "aktifMasalar",
    "oyunAlani",
    "bilgiPaneli",
    "masaAlani",
    "istakaAlani",
    "oyunuBaslatButon",
    "bitirButon",
    "masadanAyrilButon",
    "odaRozeti",
    "oyuncularKutusu",
  );

  document.body.classList.remove("game-started");

  if (screen === SCREENS.LOBBY) {
    show("anaMenu");
    show("katilAlani");
    show("aktifMasalar");
    return;
  }

  if (screen === SCREENS.ROOM) {
    show("oyunAlani");
    show("odaRozeti");
    show("oyuncularKutusu");
    show("bilgiPaneli");
    show("masadanAyrilButon");
    return;
  }

  if (screen === SCREENS.ROOM) {
    show("oyunAlani");
    show("odaRozeti");
    show("oyuncularKutusu");
    show("bilgiPaneli");
    show("masadanAyrilButon");

    refreshRoomBadge(); // ✅
    return;
  }

  if (screen === SCREENS.GAME) {
    show("oyunAlani");
    show("masaAlani");
    show("istakaAlani");
    show("bitirButon");
    show("masadanAyrilButon");

    document.body.classList.add("game-started");

    refreshRoomBadge(); // ✅
    requestAnimationFrame(() => bindDiscardSlots());
    return;
  }
}

function showMessage(title, text) {
  const panel = document.getElementById("uiMessagePanel");
  document.getElementById("uiMsgTitle").textContent = title;
  document.getElementById("uiMsgText").textContent = text;

  panel.classList.remove("hidden");

  document.getElementById("uiMsgClose").onclick = () => {
    panel.classList.add("hidden");
  };
}

function showConfirm(title, text, onOk, onCancel) {
  const panel = document.getElementById("uiConfirmPanel");
  const tEl = document.getElementById("uiConfirmTitle");
  const txtEl = document.getElementById("uiConfirmText");
  const okBtn = document.getElementById("uiConfirmOk");
  const canBtn = document.getElementById("uiConfirmCancel");

  if (!panel || !tEl || !txtEl || !okBtn || !canBtn) {
    console.error("showConfirm paneli bulunamadı.");
    return;
  }

  tEl.textContent = title;
  txtEl.textContent = text;
  panel.classList.remove("hidden");

  okBtn.onclick = null;
  canBtn.onclick = null;

  okBtn.onclick = () => {
    panel.classList.add("hidden");
    if (typeof onOk === "function") onOk();
  };

  canBtn.onclick = () => {
    panel.classList.add("hidden");
    if (typeof onCancel === "function") onCancel();
  };
}

function hide(...ids) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (!el.dataset.prevDisplay) {
      const cs = getComputedStyle(el);
      el.dataset.prevDisplay = cs.display === "none" ? "" : cs.display;
    }

    el.classList.add("hidden");
    el.style.display = "none";
  });
}

function show(id) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.remove("hidden");

  const prev = el.dataset.prevDisplay || "";
  el.style.display = prev;
}

function showBlock(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("hidden");
    el.style.display = "block";
  }
}

function showFlex(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("hidden");
    el.style.display = "flex";
  }
}
function decodeTile(tile) {
  if (tile === "0") {
    return { isEmpty: true, colorClass: "", label: "" };
  }

  if (tile.startsWith("✦")) {
    return {
      isEmpty: false,
      colorClass: "tas-beyaz",
      label: "✦" + tile.slice(2),
    };
  }

  const color = tile[0];
  const number = tile.slice(1);
  let colorClass = "";
  switch (color) {
    case "K":
      colorClass = "tas-kirmizi";
      break;
    case "M":
      colorClass = "tas-mavi";
      break;
    case "S":
      colorClass = "tas-yesil";
      break;
    case "Y":
      colorClass = "tas-sari";
      break;
  }

  return {
    isEmpty: false,
    colorClass,
    label: number,
  };
}

function renderOkeyIndicatorUI() {
  const indEl = document.getElementById("indicatorTileUI");
  if (!indEl) return;

  indEl.className = "tas indicator hidden";
  indEl.textContent = "";

  if (indicatorTile) {
    const info = decodeTile(indicatorTile);
    indEl.className =
      "tas indicator " + (info.colorClass ? info.colorClass : "");
    indEl.textContent = info.label || "";
  }
}

function sendMessage() {
  const input = document.getElementById("mesajInput");
  const msg = (input?.value || "").trim();
  if (!msg || !currentRoom) return;
  socket.emit("send_message", { msg, room: currentRoom, user: currentUser });
  input.value = "";
}

window.sendMessage = sendMessage;
