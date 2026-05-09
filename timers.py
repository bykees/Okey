# timers.py
import random
from typing import Optional

from room_store import rooms
from game_logic import TURN_TIMEOUT

from db import save_match_result


def start_turn_timer(socketio, code: str) -> None:
    """
    Her tur için tek bir aktif timer tutar.
    Yeni tur başladığında timer_token artırılır; eski timer'lar geçersiz kalır.
    """
    room = rooms.get(code)
    if not room or not room.get("started"):
        return

    room["timer_token"] = room.get("timer_token", 0) + 1
    token = room["timer_token"]

    def timer_loop(room_code: str, local_token: int) -> None:
        remain = int(TURN_TIMEOUT)

        socketio.emit(
            "timer_tick",
            {"room": room_code, "remain": remain, "total": int(TURN_TIMEOUT)},
            room=room_code,
        )

        while remain > 0:
            socketio.sleep(1)
            remain -= 1

            r = rooms.get(room_code)
            if not r or not r.get("started"):
                return

            if r.get("timer_token") != local_token:
                return

            socketio.emit(
                "timer_tick",
                {"room": room_code, "remain": remain, "total": int(TURN_TIMEOUT)},
                room=room_code,
            )

        r = rooms.get(room_code)
        if not r or not r.get("started"):
            return
        if r.get("timer_token") != local_token:
            return

        auto_discard_on_timeout(socketio, room_code)

    socketio.start_background_task(timer_loop, code, token)

def _decode_auto(tile, okey_tile=None):
    if not tile or tile == "0":
        return None

    if okey_tile and tile == okey_tile:
        return {"tile": tile, "joker": True}

    if tile == "✦":
        if not okey_tile:
            return None
        return {
            "tile": tile,
            "color": okey_tile[0],
            "number": int(okey_tile[1:]),
            "fake_okey": True,
        }

    return {
        "tile": tile,
        "color": tile[0],
        "number": int(tile[1:]),
    }


def _is_group_per(decoded):
    if len(decoded) < 3 or len(decoded) > 4:
        return False

    normal = [t for t in decoded if not t.get("joker")]
    if not normal:
        return True

    number = normal[0]["number"]
    if any(t["number"] != number for t in normal):
        return False

    colors = [t["color"] for t in normal]
    return len(colors) == len(set(colors))


def _is_series_per(decoded):
    if len(decoded) < 3:
        return False

    normal = [t for t in decoded if not t.get("joker")]
    joker_count = len(decoded) - len(normal)

    if not normal:
        return True

    color = normal[0]["color"]
    if any(t["color"] != color for t in normal):
        return False

    nums = sorted(t["number"] for t in normal)

    for i in range(1, len(nums)):
        if nums[i] == nums[i - 1]:
            return False

    gaps = 0
    for i in range(1, len(nums)):
        gaps += nums[i] - nums[i - 1] - 1

    return gaps <= joker_count


def _is_pair_group(decoded):
    if len(decoded) != 2:
        return False

    a, b = decoded

    if a.get("joker") or b.get("joker"):
        return True

    return a["color"] == b["color"] and a["number"] == b["number"]


def get_protected_auto_indexes(hand, okey_tile=None):
    protected = set()

    rows = [
        list(range(0, 16)),
        list(range(16, 32)),
    ]

    def is_valid_combo(indexes):
        decoded = []

        for idx in indexes:
            if idx >= len(hand):
                return False

            d = _decode_auto(hand[idx], okey_tile)
            if not d:
                return False

            decoded.append(d)

        return (
            _is_pair_group(decoded)
            or _is_group_per(decoded)
            or _is_series_per(decoded)
        )

    for row in rows:
        block = []

        def scan_block():
            if len(block) < 2:
                return

            for start in range(len(block)):
                for end in range(start + 2, len(block) + 1):
                    indexes = block[start:end]

                    if is_valid_combo(indexes):
                        protected.update(indexes)

        for idx in row:
            if idx >= len(hand):
                continue

            tile = hand[idx]

            if not tile or tile == "0":
                scan_block()
                block = []
            else:
                block.append(idx)

        scan_block()

    return protected

def auto_discard_on_timeout(socketio, code: str) -> None:
    """
    Süre dolunca o an sırada olan oyuncu için:
    - 15 taş varsa: otomatik taş at
    - 14 taş varsa: ortadan otomatik çek + taş at
    """
    room = rooms.get(code)
    if not room or not room.get("started"):
        return

    player: Optional[str] = room.get("current_turn")
    if not player:
        return

    hand = room.get("hands", {}).get(player)
    if not hand:
        return

    deck = room.get("deck", [])
    remaining = len(deck)

    real_tiles = [t for t in hand if t != "0"]
    real_count = len(real_tiles)

    if real_count < 14:
        return

    if real_count == 14:
        if not deck:
            try:
                save_match_result(room, code, winner_nick=None, reason="deck_empty")
            except Exception as e:
                print("DB SAVE ERROR (deck_empty):", e)

            socketio.emit(
                "game_finished",
                {"room": code, "winner": None, "reason": "deck_empty"},
                room=code,
            )
            room["started"] = False
            room["current_turn"] = None
            return

        drawn_tile = deck.pop()
        remaining = len(deck)

        placed = False
        for i, t in enumerate(hand):
            if t == "0":
                hand[i] = drawn_tile
                placed = True
                break
        if not placed:
            hand.append(drawn_tile)

        room["hands"][player] = hand
        room["deck"] = deck

        sid = room.get("sids", {}).get(player)
        if sid:
            socketio.emit(
                "tile_drawn",
                {
                    "room": code,
                    "player": player,
                    "tile": drawn_tile,
                    "deck_remaining": remaining,
                },
                to=sid,
            )

        socketio.emit(
            "deck_count_update",
            {"room": code, "remaining": remaining},
            room=code,
        )

        socketio.emit(
            "message",
            {
                "type": "system",
                "user": "SYSTEM",
                "msg": f"{player} için süre doldu, otomatik olarak bir taş çekildi.",
            },
            room=code,
        )

        real_tiles = [t for t in hand if t != "0"]
        real_count = len(real_tiles)

    if real_count < 15:
        return

    okey_tile = room.get("okey_tile")
    protected_indexes = get_protected_auto_indexes(hand, okey_tile)

    candidates = [
        (i, t)
        for i, t in enumerate(hand)
        if t != "0" and i not in protected_indexes
    ]

    if not candidates:
        candidates = [
            (i, t)
            for i, t in enumerate(hand)
            if t != "0"
        ]

    discard_index, tile_to_discard = random.choice(candidates)
    hand[discard_index] = "0"

    room["hands"][player] = hand

    room.setdefault("discard_pile", [])
    room.setdefault("last_discards", {})
    room["discard_pile"].append(tile_to_discard)
    room["last_discards"][player] = tile_to_discard

    players = room.get("players", [])
    if not players:
        room["current_turn"] = None
        room["started"] = False
        return

    if player in players:
        idx = players.index(player)
        next_player = players[(idx + 1) % len(players)]
    else:
        next_player = players[0]

    room["current_turn"] = next_player

    socketio.emit(
        "discard_made",
        {"room": code, "player": player, "tile": tile_to_discard, "next_turn": next_player},
        room=code,
    )

    socketio.emit(
        "message",
        {
            "type": "system",
            "user": "SYSTEM",
            "msg": f"{player} için süre doldu, otomatik olarak taş atıldı.",
        },
        room=code,
    )

    start_turn_timer(socketio, code)
