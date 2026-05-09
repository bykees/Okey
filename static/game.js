function getSeatByRelativeIndex(relativeIndex, total) {
  if (total <= 0) return null;

  if (total === 1) return "bottom";
  if (total === 2) return relativeIndex === 0 ? "bottom" : "top";

  if (total === 3) {
    if (relativeIndex === 0) return "bottom";
    if (relativeIndex === 1) return "right";
    return "left";
  }

  // 4+
  if (relativeIndex === 0) return "bottom";
  if (relativeIndex === 1) return "right";
  if (relativeIndex === 2) return "top";
  return "left";
}

function getDiscardSlotSelectorForSeat(seat) {
  switch (seat) {
    case "bottom":
      return ".discard-alt-sag";
    case "right":
      return ".discard-ust-sag";
    case "top":
      return ".discard-ust-sol";
    case "left":
      return ".discard-alt-sol";
    default:
      return null;
  }
}

function renderSeats(players) {
  if (!players || players.length === 0) return;

  const total = players.length;
  const myIndex = players.indexOf(currentUser);

  const seatsNames = {
    bottom: "—",
    right: "—",
    top: "—",
    left: "—",
  };

  players.forEach((p, idx) => {
    const rel = (idx - myIndex + total) % total;
    const seat = getSeatByRelativeIndex(rel, total);
    if (!seat) return;
    seatsNames[seat] = p === currentUser ? "Sen" : p;
  });

  const nb = document.getElementById("koltuk-alt-isim");
  const nr = document.getElementById("koltuk-sag-isim");
  const nt = document.getElementById("koltuk-ust-isim");
  const nl = document.getElementById("koltuk-sol-isim");

  if (nb) nb.textContent = seatsNames.bottom || "—";
  if (nr) nr.textContent = seatsNames.right || "—";
  if (nt) nt.textContent = seatsNames.top || "—";
  if (nl) nl.textContent = seatsNames.left || "—";
}

/* =========================
   SIRA / YANDAN TAŞ ALMA
   ========================= */
function updateTakeDiscardTarget() {
  if (currentTakeSlot) {
    currentTakeSlot.classList.remove("my-discard-source");
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

  slot.classList.add("my-discard-source");
  slot.onclick = () => {
    if (!isMyTurn) {
      showMessage("Uyarı", "Şu anda sıra sende değil.");
      return;
    }
    socket.emit("take_discard", {
      room: currentRoom,
      player: currentUser,
    });
  };

  currentTakeSlot = slot;
}

function updateTurnUI() {
  const seatBoxes = {
    bottom: document.querySelector(".koltuk.alt"),
    right: document.querySelector(".koltuk.sag"),
    top: document.querySelector(".koltuk.ust"),
    left: document.querySelector(".koltuk.sol"),
  };

  Object.values(seatBoxes).forEach((b) => b?.classList.remove("turn-active"));

  const players = playersState || [];
  const total = players.length;
  if (total === 0) return;

  const myIndex = players.indexOf(currentUser);
  const turnIndex = players.indexOf(currentTurnPlayer);
  if (myIndex === -1 || turnIndex === -1) return;

  const relativeIndex = (turnIndex - myIndex + total) % total;
  const seat = getSeatByRelativeIndex(relativeIndex, total);
  if (!seat) return;

  seatBoxes[seat]?.classList.add("turn-active");

  const istaka = document.getElementById("istakaAlani");
  if (istaka) {
    if (isMyTurn) istaka.classList.add("is-my-turn");
    else istaka.classList.remove("is-my-turn");
  }

  const myDiscardSlot = document.querySelector(".discard-alt-sag");
  if (myDiscardSlot) {
    if (isMyTurn) {
      myDiscardSlot.classList.add("my-turn-active");
      myDiscardSlot.classList.add("my-drop-target");
    } else {
      myDiscardSlot.classList.remove("my-turn-active");
      myDiscardSlot.classList.remove("my-drop-target");
    }
  }
}

function updateTurnText() {
  const el = document.getElementById("turnIndicator");
  if (!el) return;

  el.classList.remove("hidden");

  if (!currentTurnPlayer) {
    el.textContent = "Sıra: —";
    return;
  }

  if (isMyTurn) el.textContent = "Sıra: Sen";
  else el.textContent = `Sıra: ${currentTurnPlayer}`;
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

  slot.innerHTML = "";

  const info = decodeTile(tile);
  if (info.isEmpty) return;

  const div = document.createElement("div");
  div.className = "tas" + (info.colorClass ? " " + info.colorClass : "");
  div.textContent = info.label;
  div.style.width = "40px";
  div.style.height = "55px";
  div.style.fontSize = "14px";

  slot.appendChild(div);
}

/* =========================
   ✅ EKLENDİ: flip state (kapalı taş)
   ========================= */
let flippedTiles = new Set();

function decodeTileForVisualPer(tile) {
  if (!tile || tile === "0") return null;

  if (tile === "✦") {
    if (!okeyTile) return null;
    return {
      tile,
      color: okeyTile[0],
      number: Number(okeyTile.slice(1)),
      fakeOkey: true,
    };
  }

  if (okeyTile && tile === okeyTile) {
    return {
      tile,
      color: null,
      number: null,
      joker: true,
    };
  }

  const color = tile[0];
  const number = Number(tile.slice(1));

  if (!color || Number.isNaN(number)) return null;

  return { tile, color, number };
}

function isVisualGroupPer(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return false;

  const normal = tiles.filter((t) => !t.joker);
  const jokers = tiles.length - normal.length;

  if (!normal.length) return true;

  const sameNumber = normal.every((t) => t.number === normal[0].number);
  if (!sameNumber) return false;

  const colors = normal.map((t) => t.color);
  const uniqueColors = new Set(colors).size === colors.length;

  return uniqueColors && normal.length + jokers >= 3;
}

function isVisualSeriesPer(tiles) {
  if (tiles.length < 3) return false;

  const normal = tiles.filter((t) => !t.joker);
  const jokerCount = tiles.length - normal.length;

  if (!normal.length) return true;

  const sameColor = normal.every((t) => t.color === normal[0].color);
  if (!sameColor) return false;

  const nums = normal.map((t) => t.number).sort((a, b) => a - b);

  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === nums[i - 1]) return false;
  }

  let gaps = 0;
  for (let i = 1; i < nums.length; i++) {
    gaps += nums[i] - nums[i - 1] - 1;
  }

  return gaps <= jokerCount;
}

function getAutoPerIndexes() {
  const validIndexes = new Set();

  const rows = [
    [...Array(HER_SATIR_ICIN_SLOT).keys()],
    [...Array(HER_SATIR_ICIN_SLOT).keys()].map((i) => i + HER_SATIR_ICIN_SLOT),
  ];

  rows.forEach((rowIndexes) => {
    let group = [];

    function checkGroup() {
      if (group.length < 2) return;

      const decoded = group
        .map((idx) => decodeTileForVisualPer(myHand[idx]))
        .filter(Boolean);

      if (
        decoded.length === group.length &&
        (isVisualPairGroup(decoded) ||
          isVisualGroupPer(decoded) ||
          isVisualSeriesPer(decoded))
      ) {
        group.forEach((idx) => validIndexes.add(idx));
      }
    }

    rowIndexes.forEach((idx) => {
      const tile = myHand[idx];

      if (!tile || tile === "0") {
        checkGroup();
        group = [];
      } else {
        group.push(idx);
      }
    });

    checkGroup();
  });

  return validIndexes;
}
function isVisualPairGroup(tiles) {
  if (tiles.length !== 2) return false;

  const normal = tiles.filter((t) => !t.joker);
  const jokerCount = tiles.length - normal.length;

  if (jokerCount > 0) return true;

  return (
    normal[0].color === normal[1].color &&
    normal[0].number === normal[1].number
  );
}

function renderIstaka() {
  const area = document.getElementById("istakaAlani");
  const container = document.getElementById("istakaTaslari");
  if (!area || !container) return;

  area.classList.remove("hidden");
  container.innerHTML = "";

  const topRow = document.createElement("div");
  topRow.className = "istaka-satir istaka-satir-ust";

  const bottomRow = document.createElement("div");
  bottomRow.className = "istaka-satir istaka-satir-alt";

  const autoPerIndexes = getAutoPerIndexes();

  myHand.forEach((tile, idx) => {
    const info = decodeTile(tile);
    const div = document.createElement("div");

    div.dataset.index = idx;

    if (info.isEmpty) {
      div.className = "tas bos-tas";
      div.textContent = "";
    } else {
      div.className = "tas" + (info.colorClass ? " " + info.colorClass : "");

      if (autoPerIndexes.has(idx)) {
        div.classList.add("auto-per");
      }

      const isFlipped = flippedTiles.has(idx);
      div.classList.toggle("tile-flipped", isFlipped);
      div.textContent = isFlipped ? "" : info.label;
      div.title = isFlipped ? "Kapalı taş" : "";

      div.addEventListener("click", (e) => {
        e.preventDefault();

        selectedIndex = idx;

        renderIstaka();
      });

      div.draggable = true;
      div.addEventListener("dragstart", handleDragStart);
      div.addEventListener("dragend", handleDragEnd);

      div.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (flippedTiles.has(idx)) flippedTiles.delete(idx);
        else flippedTiles.add(idx);

        renderIstaka();
      });
    }

    if (idx === selectedIndex && !info.isEmpty) {
      div.classList.add("selected");
    }

    div.addEventListener("dragover", handleDragOver);
    div.addEventListener("drop", handleDrop);

    if (idx < HER_SATIR_ICIN_SLOT) topRow.appendChild(div);
    else bottomRow.appendChild(div);
  });

  container.appendChild(topRow);
  container.appendChild(bottomRow);
}

function handleDragStart(e) {
  const tileEl = e.currentTarget;
  const idx = Number(tileEl.dataset.index);

  dragFromIndex = idx;
  tileEl.classList.add("dragging");

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  }

  const tileCode = myHand[idx];
  const info = decodeTile(tileCode);

  if (!info || info.isEmpty) {
    dragGhostEl = null;
    return;
  }

  const ghost = document.createElement("div");
  ghost.className = "tas" + (info.colorClass ? " " + info.colorClass : "");
  ghost.textContent = info.label;

  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "-1000px";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "9999";

  document.body.appendChild(ghost);
  dragGhostEl = ghost;

  if (e.dataTransfer) {
    const rect = ghost.getBoundingClientRect();
    e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
  }
}

function handleDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "move";
  }
}

function handleDrop(e) {
  e.preventDefault();

  const toIndex = Number(e.currentTarget.dataset.index);
  if (dragFromIndex === null || dragFromIndex === toIndex) return;

  const fromTile = myHand[dragFromIndex];
  if (!fromTile || fromTile === "0") {
    dragFromIndex = null;
    return;
  }

  const targetTile = myHand[toIndex];

  const fromFlipped = flippedTiles.has(dragFromIndex);
  const toFlipped = flippedTiles.has(toIndex);

  if (!targetTile || targetTile === "0") {
    myHand[toIndex] = fromTile;
    myHand[dragFromIndex] = "0";

    if (fromFlipped) flippedTiles.add(toIndex);
    else flippedTiles.delete(toIndex);

    flippedTiles.delete(dragFromIndex);
  } else {
    myHand[dragFromIndex] = targetTile;
    myHand[toIndex] = fromTile;

    if (fromFlipped) flippedTiles.add(toIndex);
    else flippedTiles.delete(toIndex);

    if (toFlipped) flippedTiles.add(dragFromIndex);
    else flippedTiles.delete(dragFromIndex);
  }
  dragFromIndex = null;
  renderIstaka();
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  dragFromIndex = null;

  if (dragGhostEl) {
    dragGhostEl.remove();
    dragGhostEl = null;
  }
}

/* =========================
   DISCARD SLOT (SÜRÜKLE BIRAK)
   ========================= */
function handleDiscardOver(e) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = "move";
  }
  e.currentTarget.classList.add("drag-over");
}

function handleDiscardDrop(e) {
  e.preventDefault();
  const slotEl = e.currentTarget;
  slotEl.classList.remove("drag-over");

  let fromIndex = null;
  if (e.dataTransfer) {
    const idxStr = e.dataTransfer.getData("text/plain");
    if (idxStr !== undefined && idxStr !== null && idxStr !== "") {
      fromIndex = Number(idxStr);
    }
  }
  if (fromIndex === null || Number.isNaN(fromIndex)) {
    fromIndex = dragFromIndex;
  }

  if (fromIndex === null || Number.isNaN(fromIndex)) {
    console.warn("DISCARD DROP: fromIndex yok, iptal.");
    dragFromIndex = null;
    return;
  }

  if (!currentRoom || !currentUser) {
    dragFromIndex = null;
    return;
  }

  if (!isMyTurn) {
    showMessage("Uyarı", "Şu anda sıra sende değil.");
    dragFromIndex = null;
    return;
  }

  const tile = myHand[fromIndex];
  if (!tile || tile === "0") {
    dragFromIndex = null;
    return;
  }

  const realCount = myHand.filter((t) => t !== "0").length;
  if (realCount < 15) {
    showMessage("Uyarı", "Önce taş çekmelisin.");
    dragFromIndex = null;
    return;
  }

  myHand[fromIndex] = "0";
  flippedTiles.delete(fromIndex);

  dragFromIndex = null;
  selectedIndex = null;
  renderIstaka();

  lastDiscardByMe = true;

  socket.emit("discard_tile", {
    room: currentRoom,
    player: currentUser,
    tile: tile,
  });
}

function bindDiscardSlots() {
  const slots = new Set([
    ...document.querySelectorAll(".discard-slot"),
    document.querySelector(".discard-alt-sag"),
    document.querySelector(".discard-ust-sag"),
    document.querySelector(".discard-ust-sol"),
    document.querySelector(".discard-alt-sol"),
  ]);

  slots.forEach((slot) => {
    if (!slot) return;

    slot.removeEventListener("dragover", handleDiscardOver);
    slot.removeEventListener("drop", handleDiscardDrop);

    slot.addEventListener("dragover", handleDiscardOver);
    slot.addEventListener("drop", handleDiscardDrop);
  });

  const myDiscardSlot = document.querySelector(".discard-alt-sag");
  if (myDiscardSlot) {
    if (isMyTurn) myDiscardSlot.classList.add("my-drop-target");
    else myDiscardSlot.classList.remove("my-drop-target");
  }
}

socket.on("game_started", () => {
  gameStarted = true;
  setScreen(SCREENS.GAME);

  document
    .querySelectorAll(
      ".discard-slot, .discard-alt-sag, .discard-ust-sag, .discard-ust-sol, .discard-alt-sol",
    )
    .forEach((slot) => {
      if (!slot) return;
      slot.innerHTML = "";
      slot.classList.remove("my-discard-source", "drag-over", "my-turn-active");
    });

  currentTakeSlot = null;

  requestAnimationFrame(() => {
    bindDiscardSlots();
    renderOkeyIndicatorUI();
    updateTurnUI();
    updateTurnText();
    updateTakeDiscardTarget();
  });
});

socket.on("initial_hand", (data) => {
  console.log("INITIAL_HAND", data);

  const tiles = data.tiles || [];
  const arr = [...tiles];
  while (arr.length < TOPLAM_SLOT_SAYISI) {
    arr.push("0");
  }

  myHand = arr;

  flippedTiles = new Set();

  isMyTurn = !!data.is_turn;

  if (data.current_turn) {
    currentTurnPlayer = data.current_turn;
    indicatorTile = data.indicator || null;
    okeyTile = data.okey_tile || null;
  } else if (isMyTurn) {
    currentTurnPlayer = currentUser;
  }

  if (typeof data.deck_remaining === "number") {
    deckRemaining = data.deck_remaining;
  } else {
    deckRemaining = 0;
  }

  renderOkeyIndicatorUI();
  updateTurnUI();
  updateTakeDiscardTarget();
  updateTurnText();
  updateDeckCountUI();
  renderIstaka();
});

socket.on("player_left", (data) => {
  if (data.room !== currentRoom) return;

  playersState = data.players || [];
  currentTurnPlayer = data.current_turn || null;
  isMyTurn = currentTurnPlayer === currentUser;

  renderSeats(playersState);
  updateTurnUI();
  updateTakeDiscardTarget();
  updateTurnText();
});

socket.on("game_finished", (data) => {
  if (!data || data.room !== currentRoom) return;

  const winner = data.winner;

  const bar = document.getElementById("turnTimerFill");
  if (bar) bar.style.width = "0%";

  document.getElementById("gameOverWinner").textContent = winner
    ? winner
    : "Deste bitti berabere kaldı!";
  document.getElementById("gameOverPanel").classList.remove("hidden");

  document.getElementById("gameOverClose").onclick = () => {
    document.getElementById("gameOverPanel").classList.add("hidden");

    if (currentRoom) {
      socket.emit("leave_room", { room: currentRoom });
    }

    try {
      localStorage.removeItem(ROOM_KEY);
    } catch (e) {}

    resetUI();
    setScreen(SCREENS.LOBBY);

    socket.emit("get_rooms");
  };
});

socket.on("tile_drawn", (data) => {
  if (data.room !== currentRoom || data.player !== currentUser) return;

  const tile = data.tile;
  let placed = false;

  for (let i = 0; i < myHand.length; i++) {
    if (myHand[i] === "0") {
      myHand[i] = tile;
      placed = true;
      break;
    }
  }
  if (!placed) {
    myHand.push(tile);
  }

  renderIstaka();

  if (typeof data.deck_remaining === "number") {
    deckRemaining = data.deck_remaining;
  } else if (deckRemaining > 0) {
    deckRemaining--;
  }
  updateDeckCountUI();
});

socket.on("discard_taken", (data) => {
  if (data.room !== currentRoom) return;

  const fromPlayer = data.from_player;
  if (!fromPlayer || !playersState || !playersState.length) return;

  const meIndex = playersState.indexOf(currentUser);
  const pIndex = playersState.indexOf(fromPlayer);
  if (meIndex === -1 || pIndex === -1) return;

  const relativePos =
    (pIndex - meIndex + playersState.length) % playersState.length;

  let slotSelector;
  if (relativePos === 0) slotSelector = ".discard-alt-sag";
  else if (relativePos === 1) slotSelector = ".discard-ust-sag";
  else if (relativePos === 2) slotSelector = ".discard-ust-sol";
  else slotSelector = ".discard-alt-sol";

  const slot = document.querySelector(slotSelector);
  if (slot) slot.innerHTML = "";
});

socket.on("tile_taken_from_discard", (data) => {
  if (data.room !== currentRoom || data.player !== currentUser) return;

  if (currentTakeSlot) {
    currentTakeSlot.innerHTML = "";
    currentTakeSlot.classList.remove("my-discard-source");
    currentTakeSlot.onclick = null;
    currentTakeSlot = null;
  }

  const tile = data.tile;
  let placed = false;

  for (let i = 0; i < myHand.length; i++) {
    if (myHand[i] === "0") {
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

socket.on("discard_made", (data) => {
  const { room, player, tile, next_turn } = data;
  if (room !== currentRoom) return;

  showDiscardForPlayer(player, tile);

  if (player === currentUser) {
    if (lastDiscardByMe) {
      lastDiscardByMe = false;
    } else {
      for (let i = 0; i < myHand.length; i++) {
        if (myHand[i] === tile) {
          myHand[i] = "0";
          flippedTiles.delete(i);
          break;
        }
      }
      renderIstaka();
    }
  }

  isMyTurn = next_turn === currentUser;
  currentTurnPlayer = next_turn;
  updateTurnUI();
  updateTurnText();
  updateTakeDiscardTarget();
});

socket.on("deck_count_update", (data) => {
  if (data.room !== currentRoom) return;
  if (typeof data.remaining !== "number") return;

  deckRemaining = data.remaining;
  updateDeckCountUI();
});

document.addEventListener("DOMContentLoaded", () => {
  bindDiscardSlots();
});

socket.on("state_sync", (data) => {
  if (!data || data.room !== currentRoom) return;

  const discards = data.last_discards || {};
  Object.entries(discards).forEach(([player, tile]) => {
    showDiscardForPlayer(player, tile);
  });

  if (data.current_turn) {
    currentTurnPlayer = data.current_turn;
    isMyTurn = data.current_turn === currentUser;
    indicatorTile = data.indicator || indicatorTile;
    okeyTile = data.okey_tile || okeyTile;

    renderOkeyIndicatorUI();
    updateTurnUI();
    updateTurnText();
  }
  updateTakeDiscardTarget();
});

socket.on("timer_tick", (data) => {
  if (!data) return;

  if (!window.currentRoom && data.room) window.currentRoom = data.room;

  if (data.room && window.currentRoom && data.room !== window.currentRoom)
    return;

  const remain = Number(data.remain);
  const total = Number(data.total || 45);
  const percent = total > 0 ? (remain / total) * 100 : 0;

  const bar = document.getElementById("turnTimerFill");
  if (!bar) {
    console.warn("turnTimerFill bulunamadı");
    return;
  }
  bar.style.width = percent + "%";
});
