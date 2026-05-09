const socket = io();

/* =========================
   GLOBAL DURUM
   ========================= */
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
let currentTurnPlayer = null;   // şu an kimin sırası
let currentTakeSlot = null;     // yandan taş alınacak slot
let lastDiscardByMe = false;    // discard'ı ben mi attım (drag-drop) yoksa server mı (timeout)?
let deckRemaining = 0; // ortadaki destede kalan taş sayısı


const HER_SATIR_ICIN_SLOT = 16;
const TOPLAM_SLOT_SAYISI = HER_SATIR_ICIN_SLOT * 2;

// Tarayıcı bazlı tek hesap ve oda takibi
const NICK_KEY = 'hadiokey_nickname';
const ROOM_KEY = 'hadiokey_room';

/* =========================
   BASİT UI YARDIMCILARI
   ========================= */

function showMessage(title, text) {
  const panel = document.getElementById('uiMessagePanel');
  document.getElementById('uiMsgTitle').textContent = title;
  document.getElementById('uiMsgText').textContent = text;

  panel.classList.remove('hidden');

  document.getElementById('uiMsgClose').onclick = () => {
    panel.classList.add('hidden');
  };
}

function showConfirm(title, text, onOk, onCancel) {
  const panel  = document.getElementById('uiConfirmPanel');
  const tEl    = document.getElementById('uiConfirmTitle');
  const txtEl  = document.getElementById('uiConfirmText');
  const okBtn  = document.getElementById('uiConfirmOk');
  const canBtn = document.getElementById('uiConfirmCancel');

  if (!panel || !tEl || !txtEl || !okBtn || !canBtn) {
    console.error('showConfirm paneli bulunamadı.');
    return;
  }

  tEl.textContent   = title;
  txtEl.textContent = text;
  panel.classList.remove('hidden');

  okBtn.onclick  = null;
  canBtn.onclick = null;

  okBtn.onclick = () => {
    panel.classList.add('hidden');
    if (typeof onOk === 'function') onOk();
  };

  canBtn.onclick = () => {
    panel.classList.add('hidden');
    if (typeof onCancel === 'function') onCancel();
  };
}


function hide(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.style.display = 'none';
    }
  });
}

function showBlock(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.style.display = 'block';
  }
}

function showFlex(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }
}

/* =========================
   NICKNAME KİLİTLEME / RESET
   ========================= */
function lockNicknameIfNeeded() {
  const nicknameInput = document.getElementById('kullaniciAdi');
  const changeBtn = document.getElementById('isimDegistirButon');
  if (!nicknameInput) return;

  const stored = localStorage.getItem(NICK_KEY);
  if (stored) {
    nicknameInput.value = stored;
    nicknameInput.disabled = true;
    currentUser = stored;
    if (changeBtn) changeBtn.style.display = 'inline-block';
  } else {
    nicknameInput.disabled = false;
    if (changeBtn) changeBtn.style.display = 'none';
  }
}

function resetNickname() {
  if (currentRoom) {
    showMessage('Uyarı', 'Masadayken isim değiştiremezsin. Önce masadan ayrıl.');
    return;
  }

  const nicknameInput = document.getElementById('kullaniciAdi');

  showConfirm(
    'Hesabı Sıfırla',
    'Bu tarayıcıdaki hesabı sıfırlayıp yeni bir isim girmek istiyor musun?',
    () => {
      try {
        localStorage.removeItem(NICK_KEY);
        localStorage.removeItem(ROOM_KEY);
      } catch (e) {}

      if (nicknameInput) {
        nicknameInput.disabled = false;
        nicknameInput.value = '';
      }
      currentUser = null;
      lockNicknameIfNeeded();
    }
  );
}


/* =========================
   UI RESET (LOBBİYE DÖN)
   ========================= */
function resetUI() {
  document.body.classList.remove('game-started');

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

  showFlex('anaMenu');
  showFlex('katilAlani');
  showBlock('aktifMasalar');
  hide(
    'oyunAlani',
    'oyunuBaslatButon',
    'masadanAyrilButon',
    'masaAlani',
    'odaRozeti',
    'oyuncularKutusu',
    'bilgiPaneli',
    'istakaAlani',
    'bitirButon'
  );

  const chat = document.getElementById('sohbetMesajlari');
  if (chat) chat.innerHTML = '';

  const grid = document.getElementById('masalarIzgara');
  if (grid) {
    grid.innerHTML = '<p style="opacity:.8">Henüz bir masa yok, ilk masayı sen oluşturabilirsin.</p>';
  }

  const istakaDiv = document.getElementById('istakaTaslari');
  if (istakaDiv) istakaDiv.innerHTML = '';

  const turnEl = document.getElementById('turnIndicator');
  if (turnEl) {
    turnEl.textContent = 'Sıra: —';
    turnEl.classList.add('hidden');
  }
  const discardSlots = document.querySelectorAll('.discard-slot');
  discardSlots.forEach(s => {
    s.innerHTML = '';
    s.classList.remove('my-discard-source','drag-over');
  });
}

/* =========================
   DOM READY
   ========================= */
document.addEventListener('DOMContentLoaded', () => {
  resetUI();
  lockNicknameIfNeeded();
  document.body.classList.add('chat-hidden');
  setupUIBindings();
});

/* =========================
   LOBİ: MASA OLUŞTUR / KATIL
   ========================= */
function createRoom() {
  const nicknameInput = document.getElementById('kullaniciAdi');
  const nickname = nicknameInput?.value.trim();
  if (!nickname) return showMessage('Uyarı', 'Ad gir!');

  const stored = localStorage.getItem(NICK_KEY);
  if (stored && stored !== nickname) {
    showMessage('Uyarı', `Bu tarayıcı zaten "${stored}" hesabı ile kayıtlı. Başka bir hesap açamazsın.`);
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

  socket.emit('create_room', { nickname });
}

function joinRoom() {
  const nicknameInput = document.getElementById('kullaniciAdi');
  const nickname = nicknameInput?.value.trim();
  const code = document.getElementById('masaKodu').value.trim();
  if (!nickname || !code) return showMessage('Uyarı', 'Ad ve kod gerekli!');

  const stored = localStorage.getItem(NICK_KEY);
  if (stored && stored !== nickname) {
    showMessage('Uyarı', `Bu tarayıcı zaten "${stored}" hesabı ile kayıtlı. Başka bir hesap açamazsın.`);
    if (nicknameInput) nicknameInput.value = stored;
    return;
  }

  currentUser = nickname;
  currentRoom = code;

  try {
    if (!stored) {
      localStorage.setItem(NICK_KEY, nickname);
      if (nicknameInput) nicknameInput.disabled = true;
    }
  } catch (e) {}

  socket.emit('join_room', { nickname, room: code });
}

function updateDeckCountUI() {
  const deckEl = document.getElementById('ortaDeste');
  if (!deckEl) return;

  // Ortadaki "Çek" yazısını tamamen kaldırıp sayı yazıyoruz
  deckEl.textContent = deckRemaining > 0 ? String(deckRemaining) : '0';
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;

/* =========================
   SOCKET: ODA / OYUN OLAYLARI
   ========================= */
socket.on('room_created', data => {
  currentRoom = data.room;
  isHost = true;
  playersState = [data.host];
  autoRejoinTrying = false;

  try {
    localStorage.setItem(ROOM_KEY, currentRoom);
  } catch (e) {}

  document.getElementById('masaYazi').textContent = `Masa: ${currentRoom}`;
  showBlock('odaRozeti');
  showBlock('oyunAlani');
  showBlock('oyuncularKutusu');
  showBlock('bilgiPaneli');
  hide('anaMenu', 'katilAlani', 'aktifMasalar');

  showBlock('oyunuBaslatButon');
  showBlock('masadanAyrilButon');

  const joinedEl = document.getElementById('katilanSayisiMetin');
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;
  const modeEl = document.getElementById('oyunModuEtiketi');
  if (modeEl) modeEl.innerText = data.mode ? data.mode : 'Klasik';

  const oyuncuKutusu = document.getElementById('oyuncularKutusu');
  if (oyuncuKutusu) oyuncuKutusu.classList.add('hiddenToggle');
  const oyuncuTusu = document.getElementById('oyuncularTusu');
  if (oyuncuTusu) oyuncuTusu.setAttribute('aria-expanded', 'false');

  renderPlayers(playersState);
  renderSeats(playersState);
});

socket.on('room_joined', data => {
  currentRoom = data.room;
  playersState = data.players;
  isHost = currentUser === data.host;
  gameStarted = data.started;
  autoRejoinTrying = false;

  try {
    localStorage.setItem(ROOM_KEY, data.room);
  } catch (e) {}

  if (gameStarted) {
    hide('bilgiPaneli', 'anaMenu', 'katilAlani', 'aktifMasalar', 'oyunuBaslatButon', 'odaRozeti');
    showBlock('masaAlani');
    showBlock('istakaAlani');
    document.body.classList.add('game-started');
  }

  document.getElementById('masaYazi').textContent = `Masa: ${currentRoom}`;
  showBlock('odaRozeti');
  showBlock('oyunAlani');
  showBlock('oyuncularKutusu');
  showBlock('bilgiPaneli');
  hide('anaMenu', 'katilAlani', 'aktifMasalar');

  if (isHost && !gameStarted) showBlock('oyunuBaslatButon');
  else hide('oyunuBaslatButon');
  showBlock('masadanAyrilButon');

  const oyuncuKutusu = document.getElementById('oyuncularKutusu');
  if (oyuncuKutusu) oyuncuKutusu.classList.add('hiddenToggle');
  const oyuncuTusu = document.getElementById('oyuncularTusu');
  if (oyuncuTusu) oyuncuTusu.setAttribute('aria-expanded', 'false');

  const joinedEl = document.getElementById('katilanSayisiMetin');
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;

  const modeEl = document.getElementById('oyunModuEtiketi');
  if (modeEl) modeEl.innerText = data.mode ? data.mode : 'Klasik';

  renderPlayers(playersState);
  renderSeats(playersState);

  if (gameStarted) {
    socket.emit('request_hand', {
      room: currentRoom,
      player: currentUser
    });
  }
});

socket.on('update_players', data => {
  playersState = data.players;
  renderPlayers(playersState);
  renderSeats(playersState);

  const joinedEl = document.getElementById('katilanSayisiMetin');
  if (joinedEl) joinedEl.innerText = `${playersState.length}/4`;
});

socket.on('game_started', () => {
  hide('oyunuBaslatButon', 'odaRozeti', 'anaMenu', 'katilAlani', 'aktifMasalar', 'bilgiPaneli');
  showBlock('masadanAyrilButon');
  showBlock('masaAlani');
  showBlock('istakaAlani');
  showBlock('bitirButon');

  gameStarted = true;
  document.body.classList.add('game-started');

  // 🔄 Yeni oyun başlarken masadaki eski atılmış taşları temizle
  document.querySelectorAll('.discard-slot').forEach(slot => {
    slot.innerHTML = '';
    slot.classList.remove('my-discard-source','drag-over');
  });

  // Sıra/yandan alma hedefini de sıfırlamak istersen:
  currentTakeSlot = null;

  gameStarted = true;
  document.body.classList.add('game-started');
});

socket.on('initial_hand', data => {
  hide('bilgiPaneli', 'anaMenu', 'katilAlani', 'aktifMasalar', 'oyunuBaslatButon', 'odaRozeti');
  showBlock('masaAlani');
  showBlock('istakaAlani');
  document.body.classList.add('game-started');

  const tiles = data.tiles || [];
  const arr = [...tiles];
  while (arr.length < TOPLAM_SLOT_SAYISI) {
    arr.push('0');
  }

  myHand = arr;
  isMyTurn = !!data.is_turn;
  if (isMyTurn) currentTurnPlayer = currentUser;

    // Server'dan gelen destedeki taş sayısı (backend'de göndermen gerekiyor)
  if (typeof data.deck_remaining === 'number') {
    deckRemaining = data.deck_remaining;
  } else {
    // server henüz göndermiyorsa, en azından 0'dan başla
    deckRemaining = 0;
  }

  updateTurnUI();
  updateTakeDiscardTarget();
  updateTurnText();
  updateDeckCountUI();
  renderIstaka();
});

socket.on('player_left', data => {
  if (data.room !== currentRoom) return;

  playersState = data.players || [];
  currentTurnPlayer = data.current_turn || null;
  isMyTurn = currentTurnPlayer === currentUser;

  renderSeats(playersState);
  updateTurnUI();
  updateTakeDiscardTarget();
  updateTurnText();
});

/* =========================
   HATA / MESAJ / CONNECT
   ========================= */
socket.on('error', d => {
  const msg = d?.msg || 'Bilinmeyen hata';

  if (autoRejoinTrying && msg === 'Masa bulunamadı!') {
    autoRejoinTrying = false;
    try {
      localStorage.removeItem(ROOM_KEY);
    } catch (e) {}
    return;
  }

  autoRejoinTrying = false;
  showMessage('Hata', msg);
});

socket.on('message', data => {
  const chat = document.getElementById('sohbetMesajlari');
  if (!chat) return;

  if (data.type === 'system') {
    chat.innerHTML += `<p style="opacity:.85"><em>🔔 ${data.msg}</em></p>`;
  } else {
    const user = data.user || 'Anonim';
    chat.innerHTML += `<p><strong>${user}:</strong> ${data.msg}</p>`;
  }
  chat.scrollTop = chat.scrollHeight;
});

socket.on('connect', () => {
  try {
    const storedNick = localStorage.getItem(NICK_KEY);
    const storedRoom = localStorage.getItem(ROOM_KEY);

    if (storedNick && storedRoom && !currentRoom) {
      autoRejoinTrying = true;

      currentUser = storedNick;
      currentRoom = storedRoom;

      socket.emit('join_room', {
        nickname: storedNick,
        room: storedRoom
      });
    }
  } catch (e) {
    autoRejoinTrying = false;
  }
});

socket.on('game_finished', (data) => {
  if (data.room !== currentRoom) return;

  const winner = data.winner;

  // Timer sıfırla
  const bar = document.getElementById('turnTimerFill');
  if (bar) bar.style.width = "0%";

  // Panel içeriğini doldur
  document.getElementById('gameOverWinner').textContent = winner;
  
  // Göster
  document.getElementById('gameOverPanel').classList.remove('hidden');

  // Butona basıldığında kapat
  document.getElementById('gameOverClose').onclick = () => {
    document.getElementById('gameOverPanel').classList.add('hidden');
    resetUI(); // seni tekrar lobiye döndürür
  };
});

/* =========================
   SOHBET
   ========================= */
function sendMessage() {
  const input = document.getElementById('mesajInput');
  const msg = (input?.value || '').trim();
  if (!msg || !currentRoom) return;
  socket.emit('send_message', { msg, room: currentRoom, user: currentUser });
  input.value = '';
}

/* =========================
   UI EVENT BINDINGS
   ========================= */
function setupUIBindings() {
  const createBtn = document.getElementById('masaOlusturButon');
  if (createBtn) {
    createBtn.addEventListener('click', e => {
      e.preventDefault();
      createRoom();
    });
  }

  const joinBtn = document.getElementById('katilButon');
  if (joinBtn) {
    joinBtn.addEventListener('click', e => {
      e.preventDefault();
      joinRoom();
    });
  }

  const nicknameInput = document.getElementById('kullaniciAdi');
  if (nicknameInput) {
    nicknameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createRoom();
      }
    });
  }

  const changeBtn = document.getElementById('isimDegistirButon');
  if (changeBtn) {
    changeBtn.addEventListener('click', resetNickname);
  }

  const roomInput = document.getElementById('masaKodu');
  if (roomInput) {
    roomInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinRoom();
      }
    });
  }

  const copyBtn = document.getElementById('kopyalaButon');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const code =
        currentRoom ||
        (document.getElementById('masaYazi')?.textContent || '').replace('Masa:', '').trim();
      if (!code || code === '—') return showMessage('Uyarı', 'Önce bir masaya gir/oluştur.');
      navigator.clipboard
        .writeText(code)
        .then(() => showMessage('Bilgi', `Masa kodu kopyalandı: ${code}`))
        .catch(() => showMessage('Hata', 'Masa kodu kopyalanamadı.'));
    });
  }

  const sendBtn = document.getElementById('mesajGonderButon');
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);
  const msgInput = document.getElementById('mesajInput');
  if (msgInput) {
    msgInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  const chatToggle = document.getElementById('sohbetToggleButon');
  if (chatToggle) {
    chatToggle.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('chat-hidden');
      chatToggle.setAttribute('aria-expanded', String(!hidden));
    });
  }

  const playersToggle = document.getElementById('oyuncularTusu');
  if (playersToggle) {
    playersToggle.addEventListener('click', () => {
      const box = document.getElementById('oyuncularKutusu');
      if (!box) return;
      const isHidden = box.classList.toggle('hiddenToggle');
      if (isHidden) setTimeout(() => (box.style.display = 'none'), 250);
      else box.style.display = 'flex';
      playersToggle.setAttribute('aria-expanded', String(!isHidden));
    });
  }

  const startBtn = document.getElementById('oyunuBaslatButon');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (!isHost || gameStarted) return;
       showConfirm(
      'Oyunu Başlat',
      'Oyunu başlatmak istediğine emin misin?',
      () => {
        socket.emit('start_game', { room: currentRoom });
      }
    );
    });
  }

  const leaveBtn = document.getElementById('masadanAyrilButon');
if (leaveBtn) {
  leaveBtn.addEventListener('click', () => {
    if (!currentRoom || !currentUser) return;

    showConfirm(
      'Masadan Ayrıl',
      'Masadan ayrılmak istediğine emin misin?',
      () => {
        socket.emit('leave_room', { nickname: currentUser, room: currentRoom });

        try {
          localStorage.removeItem(ROOM_KEY);
        } catch (e) {}

        resetUI();
        lockNicknameIfNeeded();
        socket.emit('get_rooms');
      }
    );
  });
}

  const deckEl = document.getElementById('ortaDeste');
  if (deckEl) {
    deckEl.addEventListener('click', () => {
      if (!currentRoom || !currentUser) return;

      if (!isMyTurn) {
        showMessage('Uyarı', 'Şu anda sıra sende değil.');
        return;
      }

      socket.emit('draw_tile', {
        room: currentRoom,
        player: currentUser
      });
    });
  }

  // Taş atma slotu: sadece sağ-alt (bizim taraf)
  const myDiscardSlot = document.querySelector('.discard-alt-sag');
  if (myDiscardSlot) {
    myDiscardSlot.classList.add('my-drop-target');
    myDiscardSlot.addEventListener('dragover', handleDiscardOver);
    myDiscardSlot.addEventListener('drop', handleDiscardDrop);
  }

  const finishBtn = document.getElementById('bitirButon');
if (finishBtn) {
  finishBtn.addEventListener('click', () => {
    if (!currentRoom || !currentUser) return;

    if (!isMyTurn) {
      showMessage('Uyarı', 'Sıra sende değilken bitiremezsin.');
      return;
    }

    showConfirm(
      'Eli Bitir',
      'Bu eli bitirmek istediğine emin misin?',
      () => {
        socket.emit('finish_hand', {
          room: currentRoom,
          player: currentUser
        });
      }
    );
  });
}



}

/* =========================
   OYUNCU LİSTESİ / KOLTUKLAR
   ========================= */
function renderPlayers(players) {
  const titleEl = document.querySelector('#oyuncularKutusu .kutu-baslik');
  if (titleEl) titleEl.textContent = `👥 Oyuncular (${players.length}/4)`;

  const list = document.getElementById('oyuncularListesi');
  if (!list) return;
  list.innerHTML = '';

  players.forEach(p => {
    const li = document.createElement('li');
    if (p === players[0]) {
      li.innerHTML = `<strong>${p}</strong> <span class="kurucu-yildiz">★</span>`;
    } else {
      li.textContent = p;
    }
    list.appendChild(li);
  });
}

// relativeIndex: 0 = ben, 1 = benden sonraki, ...
function getSeatByRelativeIndex(relativeIndex, total) {
  if (total <= 0) return null;

  if (total === 1) return 'bottom';
  if (total === 2) return relativeIndex === 0 ? 'bottom' : 'top';

  if (total === 3) {
    if (relativeIndex === 0) return 'bottom';
    if (relativeIndex === 1) return 'right';
    return 'left';
  }

  // 4+
  if (relativeIndex === 0) return 'bottom';
  if (relativeIndex === 1) return 'right';
  if (relativeIndex === 2) return 'top';
  return 'left';
}

function getDiscardSlotSelectorForSeat(seat) {
  switch (seat) {
    case 'bottom':
      return '.discard-alt-sag';
    case 'right':
      return '.discard-ust-sag';
    case 'top':
      return '.discard-ust-sol';
    case 'left':
      return '.discard-alt-sol';
    default:
      return null;
  }
}

function renderSeats(players) {
  if (!players || players.length === 0) return;

  const total = players.length;
  const myIndex = players.indexOf(currentUser);

  const seatsNames = {
    bottom: '—',
    right: '—',
    top: '—',
    left: '—'
  };

  players.forEach((p, idx) => {
    const rel = (idx - myIndex + total) % total;
    const seat = getSeatByRelativeIndex(rel, total);
    if (!seat) return;
    seatsNames[seat] = p === currentUser ? 'Sen' : p;
  });

  const nb = document.getElementById('koltuk-alt-isim');
  const nr = document.getElementById('koltuk-sag-isim');
  const nt = document.getElementById('koltuk-ust-isim');
  const nl = document.getElementById('koltuk-sol-isim');

  if (nb) nb.textContent = seatsNames.bottom || '—';
  if (nr) nr.textContent = seatsNames.right || '—';
  if (nt) nt.textContent = seatsNames.top || '—';
  if (nl) nl.textContent = seatsNames.left || '—';
}

/* =========================
   SIRA / YANDAN TAŞ ALMA
   ========================= */
function updateTakeDiscardTarget() {
  // Önce eski slotu temizle
  if (currentTakeSlot) {
    currentTakeSlot.classList.remove('my-discard-source');
    currentTakeSlot.onclick = null;
    currentTakeSlot = null;
  }

  if (!isMyTurn || !currentRoom || !currentUser) return;
  if (!playersState || playersState.length < 2) return;

  const total = playersState.length;
  const myIndex = playersState.indexOf(currentUser);
  if (myIndex === -1) return;

  const prevIndex = (myIndex - 1 + total) % total;
  const relativePos = (prevIndex - myIndex + total) % total;
  const seat = getSeatByRelativeIndex(relativePos, total);
  const selector = getDiscardSlotSelectorForSeat(seat);
  if (!selector) return;

  const slot = document.querySelector(selector);
  if (!slot) return;

  slot.classList.add('my-discard-source');
  slot.onclick = () => {
    if (!isMyTurn) {
      showMessage('Uyarı', 'Şu anda sıra sende değil.');
      return;
    }
    socket.emit('take_discard', {
      room: currentRoom,
      player: currentUser
    });
  };

  currentTakeSlot = slot;
}

function updateTurnUI() {
  const seatBoxes = {
    bottom: document.querySelector('.koltuk.alt'),
    right: document.querySelector('.koltuk.sag'),
    top: document.querySelector('.koltuk.ust'),
    left: document.querySelector('.koltuk.sol')
  };

  Object.values(seatBoxes).forEach(b => b?.classList.remove('turn-active'));

  const players = playersState || [];
  const total = players.length;
  if (total === 0) return;

  const myIndex = players.indexOf(currentUser);
  const turnIndex = players.indexOf(currentTurnPlayer);
  if (myIndex === -1 || turnIndex === -1) return;

  const relativeIndex = (turnIndex - myIndex + total) % total;
  const seat = getSeatByRelativeIndex(relativeIndex, total);
  if (!seat) return;

  seatBoxes[seat]?.classList.add('turn-active');

  const istaka = document.getElementById('istakaAlani');
  if (istaka) {
    if (isMyTurn) istaka.classList.add('is-my-turn');
    else istaka.classList.remove('is-my-turn');
  }

  // 🔥 KENDİ TAŞ ATMA SLOTUNU PARLAT
  const myDiscardSlot = document.querySelector('.discard-alt-sag');
  if (myDiscardSlot) {
    if (isMyTurn) {
      myDiscardSlot.classList.add('my-turn-active');
    } else {
      myDiscardSlot.classList.remove('my-turn-active');
    }
  }
}


function updateTurnText() {
  const el = document.getElementById('turnIndicator');
  if (!el) return;

  el.classList.remove('hidden');

  if (!currentTurnPlayer) {
    el.textContent = 'Sıra: —';
    return;
  }

  if (isMyTurn) el.textContent = 'Sıra: Sen';
  else el.textContent = `Sıra: ${currentTurnPlayer}`;
}

/* =========================
   TAŞ DECODE + DISCARD GÖSTERİM
   ========================= */
function decodeTile(tile) {
  if (tile === '0') {
    return { isEmpty: true, colorClass: '', label: '' };
  }

  if (tile.startsWith('SJ')) {
    return {
      isEmpty: false,
      colorClass: 'tas-beyaz',
      label: 'J' + tile.slice(2)
    };
  }

  const color = tile[0];
  const number = tile.slice(1);
  let colorClass = '';
  switch (color) {
    case 'K':
      colorClass = 'tas-kirmizi';
      break;
    case 'M':
      colorClass = 'tas-mavi';
      break;
    case 'S':
      colorClass = 'tas-yesil';
      break;
    case 'Y':
      colorClass = 'tas-sari';
      break;
  }

  return {
    isEmpty: false,
    colorClass,
    label: number
  };
}

function showDiscardForPlayer(player, tile) {
  if (!playersState || playersState.length === 0) return;
  if (!currentUser) return;

  const total = playersState.length;
  const meIndex = playersState.indexOf(currentUser);
  const pIndex = playersState.indexOf(player);

  if (meIndex === -1 || pIndex === -1) return;

  const relativePos = (pIndex - meIndex + total) % total;
  const seat = getSeatByRelativeIndex(relativePos, total);
  const slotSelector = getDiscardSlotSelectorForSeat(seat);
  if (!slotSelector) return;

  const slot = document.querySelector(slotSelector);
  if (!slot) return;

  slot.innerHTML = '';

  const info = decodeTile(tile);
  if (info.isEmpty) return;

  const div = document.createElement('div');
  div.className = 'tas' + (info.colorClass ? ' ' + info.colorClass : '');
  div.textContent = info.label;
  div.style.width = '40px';
  div.style.height = '55px';
  div.style.fontSize = '14px';

  slot.appendChild(div);
}

/* =========================
   İSTAKA RENDER + DRAG&DROP
   ========================= */
function renderIstaka() {
  const area = document.getElementById('istakaAlani');
  const container = document.getElementById('istakaTaslari');
  if (!area || !container) return;

  area.classList.remove('hidden');
  container.innerHTML = '';

  const topRow = document.createElement('div');
  topRow.className = 'istaka-satir istaka-satir-ust';

  const bottomRow = document.createElement('div');
  bottomRow.className = 'istaka-satir istaka-satir-alt';

  myHand.forEach((tile, idx) => {
    const info = decodeTile(tile);
    const div = document.createElement('div');

    if (info.isEmpty) {
      div.className = 'tas bos-tas';
      div.textContent = '';
    } else {
      div.className = 'tas' + (info.colorClass ? ' ' + info.colorClass : '');
      div.textContent = info.label;

      div.addEventListener('click', () => {
        selectedIndex = idx;
        renderIstaka();
      });
    }

    if (idx === selectedIndex && !info.isEmpty) {
      div.classList.add('selected');
    }

    div.dataset.index = idx;

    if (!info.isEmpty) {
      div.draggable = true;
      div.addEventListener('dragstart', handleDragStart);
      div.addEventListener('dragend', handleDragEnd);

      div.addEventListener('dblclick', () => {
        const moved = myHand.splice(idx, 1)[0];
        myHand.push(moved);
        renderIstaka();
      });
    }

    div.addEventListener('dragover', handleDragOver);
    div.addEventListener('drop', handleDrop);

    if (idx < HER_SATIR_ICIN_SLOT) topRow.appendChild(div);
    else bottomRow.appendChild(div);
  });

  container.appendChild(topRow);
  container.appendChild(bottomRow);
}

function handleDragStart(e) {
  const tileEl = e.currentTarget;
  dragFromIndex = Number(tileEl.dataset.index);

  tileEl.classList.add('dragging');

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragFromIndex.toString());
  }
}

function handleDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

function handleDrop(e) {
  e.preventDefault();

  const toIndex = Number(e.currentTarget.dataset.index);
  if (dragFromIndex === null || dragFromIndex === toIndex) return;

  const fromTile = myHand[dragFromIndex];
  if (!fromTile || fromTile === '0') {
    dragFromIndex = null;
    return;
  }

  const targetTile = myHand[toIndex];

  if (!targetTile || targetTile === '0') {
    myHand[toIndex] = fromTile;
    myHand[dragFromIndex] = '0';
  } else {
    myHand[dragFromIndex] = targetTile;
    myHand[toIndex] = fromTile;
  }

  dragFromIndex = null;
  renderIstaka();
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragFromIndex = null;
}

/* =========================
   DISCARD SLOT (SÜRÜKLE BIRAK)
   ========================= */
function handleDiscardOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  e.currentTarget.classList.add('drag-over');
}

function handleDiscardDrop(e) {
  e.preventDefault();
  const slotEl = e.currentTarget;
  slotEl.classList.remove('drag-over');

  if (dragFromIndex === null) return;
  if (!currentRoom || !currentUser) {
    dragFromIndex = null;
    return;
  }

  if (!isMyTurn) {
    showMessage('Uyarı', 'Şu anda sıra sende değil.');
    dragFromIndex = null;
    return;
  }

  const tile = myHand[dragFromIndex];
  if (!tile || tile === '0') {
    dragFromIndex = null;
    return;
  }

  const realCount = myHand.filter(t => t !== '0').length;
  if (realCount < 15) {
    showMessage('Uyarı', 'Önce taş çekmelisin.');
    dragFromIndex = null;
    return;
  }

  myHand[dragFromIndex] = '0';
  dragFromIndex = null;
  selectedIndex = null;
  renderIstaka();

  // Bu discard'ı BEN attım (drag-drop ile)
  lastDiscardByMe = true;

  socket.emit('discard_tile', {
    room: currentRoom,
    player: currentUser,
    tile: tile
  });
}

/* =========================
   AKTİF MASALAR MODÜLÜ
   ========================= */
(function RoomsModule() {
  function $(id) {
    return document.getElementById(id);
  }

  const grid = $('masalarIzgara');
  if (!grid) return;

  function renderRooms(rooms) {
    grid.innerHTML = '';

    if (!rooms || !rooms.length) {
      grid.innerHTML =
        '<p style="opacity:.8">Henüz bir masa yok, ilk masayı sen oluşturabilirsin.</p>';
      return;
    }

    rooms.forEach(r => {
      const full = r.players >= 4;
      const started = !!r.started;

      const card = document.createElement('div');
      card.className = 'masa-karti';
      card.innerHTML = `
        <h4>${r.code}</h4>
        <div>Kurucu: <strong>${r.host}</strong></div>
        <div class="rozetler">
          <span class="rozet">Oyuncu: ${r.players}/4</span>
          <span class="rozet">${started ? 'Başladı' : 'Bekliyor'}</span>
        </div>
        <button ${started || full ? 'disabled' : ''}>Katıl</button>
      `;

      const btn = card.querySelector('button');
      btn?.addEventListener('click', () => {
        const nickEl = $('kullaniciAdi');
        const roomEl = $('masaKodu');
        const nick = nickEl?.value.trim();
        if (!nick) return showMessage('Uyarı', 'Önce kullanıcı adını gir!');
        if (roomEl) roomEl.value = r.code;
        if (typeof joinRoom === 'function') joinRoom();
      });

      grid.appendChild(card);
    });
  }

  socket.on('rooms_list', data => {
    if (!currentRoom) renderRooms(data.rooms || []);
  });

  socket.on('rooms_update', data => {
    const lobby = document.getElementById('aktifMasalar');
    const lobbyVisible =
      lobby && lobby.style.display !== 'none' && !lobby.classList.contains('hidden');
    if (lobbyVisible) {
      renderRooms(data.rooms || []);
    }
  });

    socket.on('timer_tick', (data) => {
    if (data.room !== currentRoom) return;

    const remain = data.remain;              // kaç saniye kaldı
    const total  = data.total || 5;          // güvenlik için default 5
    const percent = (remain / total) * 100;

    const bar = document.getElementById('turnTimerFill');
    if (bar) {
      bar.style.width = percent + '%';
    }
  });




  socket.on('tile_drawn', data => {
    if (data.room !== currentRoom || data.player !== currentUser) return;

    const tile = data.tile;
    let placed = false;

    for (let i = 0; i < myHand.length; i++) {
      if (myHand[i] === '0') {
        myHand[i] = tile;
        placed = true;
        break;
      }
    }
    if (!placed) {
      myHand.push(tile);
    }

    renderIstaka();
    // Sıra hâlâ sende, tur bitmedi → currentTurnPlayer'ı elleme

        // Destedeki taş sayısını güncelle
    if (typeof data.deck_remaining === 'number') {
      deckRemaining = data.deck_remaining;
    } else if (deckRemaining > 0) {
      // Backend sayı göndermiyorsa, en azından 1 azalt (geçici çözüm)
      deckRemaining--;
    }
    updateDeckCountUI();

  });

  socket.on('discard_taken', data => {
    if (data.room !== currentRoom) return;

    const fromPlayer = data.from_player;
    if (!fromPlayer || !playersState || !playersState.length) return;

    const meIndex = playersState.indexOf(currentUser);
    const pIndex = playersState.indexOf(fromPlayer);
    if (meIndex === -1 || pIndex === -1) return;

    const relativePos =
      (pIndex - meIndex + playersState.length) % playersState.length;

    let slotSelector;
    if (relativePos === 0) slotSelector = '.discard-alt-sag';
    else if (relativePos === 1) slotSelector = '.discard-ust-sag';
    else if (relativePos === 2) slotSelector = '.discard-ust-sol';
    else slotSelector = '.discard-alt-sol';

    const slot = document.querySelector(slotSelector);
    if (slot) slot.innerHTML = '';
  });

  // Yandan taş alındı: sadece alan oyuncuya gelir
  socket.on('tile_taken_from_discard', data => {
    if (data.room !== currentRoom || data.player !== currentUser) return;

    const tile = data.tile;
    let placed = false;

    for (let i = 0; i < myHand.length; i++) {
      if (myHand[i] === '0') {
        myHand[i] = tile;
        placed = true;
        break;
      }
    }
    if (!placed) {
      myHand.push(tile);
    }

    renderIstaka();
  });

  // Taş atıldı
  socket.on('discard_made', data => {
    const { room, player, tile, next_turn } = data;
    if (room !== currentRoom) return;

    // Discard görselini masaya yerleştir
    showDiscardForPlayer(player, tile);

    // Eğer discard yapan BEN isem:
    if (player === currentUser) {
      if (lastDiscardByMe) {
        // Bu discard'ı zaten biz drag-drop ile attık, elde 0'a çevirdik
        lastDiscardByMe = false;
      } else {
        // Server otomatik taş attı (timeout) → elde bu taşı bul ve 0 yap
        for (let i = 0; i < myHand.length; i++) {
          if (myHand[i] === tile) {
            myHand[i] = '0';
            break;
          }
        }
        renderIstaka();
      }
    }

    // Sıra güncelle
    isMyTurn = next_turn === currentUser;
    currentTurnPlayer = next_turn;
    updateTurnUI();
    updateTurnText();
    updateTakeDiscardTarget();
  });

    // Destedeki taş sayısı güncellemesi (her draw sonrası tüm odaya yayınlansın)
  socket.on('deck_count_update', data => {
    if (data.room !== currentRoom) return;
    if (typeof data.remaining !== 'number') return;

    deckRemaining = data.remaining;
    updateDeckCountUI();
  });

  socket.on('state_sync', data => {
    if (!data || data.room !== currentRoom) return;

    const discards = data.last_discards || {};
    Object.entries(discards).forEach(([player, tile]) => {
      showDiscardForPlayer(player, tile);
    });

    if (data.current_turn) {
      currentTurnPlayer = data.current_turn;
      isMyTurn = data.current_turn === currentUser;
      updateTurnUI();
      updateTurnText();
    }
    updateTakeDiscardTarget();
  });

  socket.on('connect', () => socket.emit('get_rooms'));
  $('yenileButon')?.addEventListener('click', () => socket.emit('get_rooms'));
})();
