import random
from room_store import rooms
from timers import start_turn_timer
from db import save_match_result


def is_bot_player(nick):
    return isinstance(nick, str) and nick.startswith("BOT_")


def trigger_bot_if_needed(socketio, code):
    room = rooms.get(code)
    if not room or not room.get("started"):
        return

    current = room.get("current_turn")
    if current and is_bot_player(current):
        socketio.start_background_task(handle_bot_turn, socketio, code, current)


def handle_bot_turn(socketio, code, bot_nickname):
    room = rooms.get(code)
    if not room or not room.get("started"):
        return

    if room.get("current_turn") != bot_nickname:
        return

    socketio.sleep(random.randint(10, 15))

    room = rooms.get(code)
    if not room or not room.get("started"):
        return

    if room.get("current_turn") != bot_nickname:
        return

    hand = room.get("hands", {}).get(bot_nickname)
    if not hand:
        return

    deck = room.get("deck", [])

    real_tiles = [t for t in hand if t != "0"]

    if len(real_tiles) == 14:
        if not deck:
            try:
                save_match_result(room, code, winner_nick=None, reason="deck_empty")
            except Exception as e:
                print("DB SAVE ERROR BOT deck_empty:", e)

            socketio.emit("game_finished", {
                "room": code,
                "winner": None,
                "reason": "deck_empty"
            }, room=code)

            room["started"] = False
            room["current_turn"] = None
            return

        drawn_tile = deck.pop()

        placed = False
        for i, t in enumerate(hand):
            if t == "0":
                hand[i] = drawn_tile
                placed = True
                break

        if not placed:
            hand.append(drawn_tile)

        room["hands"][bot_nickname] = hand

        socketio.emit("deck_count_update", {
            "room": code,
            "remaining": len(deck)
        }, room=code)

        socketio.emit("message", {
            "type": "system",
            "user": "SYSTEM",
            "msg": f"{bot_nickname} taş çekti."
        }, room=code)

    real_tiles = [t for t in hand if t != "0"]

    if len(real_tiles) < 15:
        return

    okey_tile = room.get("okey_tile")

    def score_tile(tile, hand, okey_tile):
        if tile == okey_tile:
            return 999

        # Sahte okey gibi özel taşları rastgele/orta değerli sayalım
        if tile == "✦":
            return 3

        try:
            color = tile[0]
            number = int(tile[1:])
        except Exception:
            return 0

        same_number = 0
        same_color_seq = 0

        for t in hand:
            if t == "0" or t == tile:
                continue

            if t == okey_tile:
                continue

            if t == "✦":
                continue

            try:
                t_color = t[0]
                t_number = int(t[1:])
            except Exception:
                continue

            # Aynı sayı farklı renk: per ihtimali
            if t_number == number:
                same_number += 1

            # Aynı renk yakın sayı: seri ihtimali
            if t_color == color:
                if abs(t_number - number) == 1:
                    same_color_seq += 2
                elif abs(t_number - number) == 2:
                    same_color_seq += 1

        return same_number * 3 + same_color_seq


    discard_candidates = [t for t in real_tiles if t != okey_tile]

    if not discard_candidates:
        discard_candidates = real_tiles

    scored_tiles = []

    for t in discard_candidates:
        score = score_tile(t, real_tiles, okey_tile)
        scored_tiles.append((t, score))

    scored_tiles.sort(key=lambda x: x[1])

    tile_to_discard = scored_tiles[0][0]

    for i, t in enumerate(hand):
        if t == tile_to_discard:
            hand[i] = "0"
            break

    room["hands"][bot_nickname] = hand

    room.setdefault("discard_pile", [])
    room.setdefault("last_discards", {})

    room["discard_pile"].append(tile_to_discard)
    room["last_discards"][bot_nickname] = tile_to_discard

    players = room.get("players", [])
    if not players:
        room["started"] = False
        room["current_turn"] = None
        return

    idx = players.index(bot_nickname)
    next_player = players[(idx + 1) % len(players)]

    room["current_turn"] = next_player

    socketio.emit("discard_made", {
        "room": code,
        "player": bot_nickname,
        "tile": tile_to_discard,
        "next_turn": next_player
    }, room=code)

    socketio.emit("message", {
        "type": "system",
        "user": "SYSTEM",
        "msg": f"{bot_nickname} taş attı."
    }, room=code)

    start_turn_timer(socketio, code)
    trigger_bot_if_needed(socketio, code)