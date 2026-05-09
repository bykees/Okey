from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room
import random
import json
from db import save_match_result
import mysql.connector
from bot_logic import trigger_bot_if_needed



from room_store import rooms, MAX_PLAYERS, generate_room_code, serialize_rooms, find_by_sid
from game_logic import create_deck, deal_tiles, is_valid_win_hand, draw_indicator, determine_okey_from_indicator
from timers import start_turn_timer, auto_discard_on_timeout

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

def get_db():
    return mysql.connector.connect(
        host="127.0.0.1",
        user="root",
        password="",         
        database="hadiokey",
        autocommit=True
    )


def emit_rooms_update():
    """Tüm kullanıcılara güncel masa listesini gönder."""
    socketio.emit('rooms_update', {'rooms': serialize_rooms()})


# -------- HTTP --------
@app.route('/')
def index():
    return render_template('index.html')


# -------- Socket.IO: Oda Oluştur / Katıl --------
@socketio.on('create_room')
def create_room(data):
    nickname = (data or {}).get('nickname', '').strip()
    mode = (data or {}).get('mode', 'Klasik')
    if not nickname:
        emit('error', {'msg': 'Kullanıcı adı gerekli!'})
        return

    code = generate_room_code()
    rooms[code] = {
        'host': {'nickname': nickname, 'sid': request.sid},
        'players': [nickname],
        'sids': {nickname: request.sid},
        'started': False,
        'mode': mode,

        'deck': [],
        'hands': {},
        'current_turn': None,
        'discard_pile': [],
        'last_discards': {},

        'timer_token': 0,
        'starter': None,
        'winner': None,

        'indicator': None,
        'okey_tile': None,

    }

    join_room(code)

    emit('room_created', {
        'room': code,
        'players': rooms[code]['players'],
        'host': rooms[code]['host']['nickname'],
        'started': False,
        'mode': mode,
    })

    emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{nickname} odayı oluşturdu ve katıldı.'
    }, room=code)

    emit_rooms_update()


@socketio.on('join_room')
def join(data):
    nickname = (data or {}).get('nickname', '').strip()
    code = (data or {}).get('room', '').strip()

    if not nickname or not code:
        emit('error', {'msg': 'Kullanıcı adı ve masa kodu gerekli!'})
        return
    if code not in rooms:
        emit('error', {'msg': 'Masa bulunamadı!'})
        return

    room = rooms[code]

    if room['started'] and nickname not in room['players']:
        emit('error', {'msg': 'Bu masada oyun zaten başladı!'})
        return

    if len(room['players']) >= MAX_PLAYERS and nickname not in room['players']:
        emit('error', {'msg': f'Bu masa dolu ({MAX_PLAYERS}/{MAX_PLAYERS}).'})
        return

    existing_sid = room['sids'].get(nickname)
    if existing_sid and existing_sid != request.sid:
        room['sids'][nickname] = request.sid

        if isinstance(room.get('host'), dict) and room['host'].get('nickname') == nickname:
            room['host']['sid'] = request.sid

    is_new_player = nickname not in room['players']

    if is_new_player:
        room['players'].append(nickname)

    room['sids'][nickname] = request.sid
    if isinstance(room.get('host'), dict) and room['host'].get('nickname') == nickname:
        room['host']['sid'] = request.sid

    join_room(code)

    emit('room_joined', {
        'room': code,
        'players': room['players'],
        'host': room['host']['nickname'],
        'started': room['started'],
        'mode': room.get('mode', 'Klasik'),
        'deck_remaining': len(room.get('deck', [])),

        'indicator': room.get('indicator'),
        'okey_tile': room.get('okey_tile'),
    })

    if is_new_player:
        emit('update_players', {'players': room['players']}, room=code)
        emit('message', {
            'type': 'system',
            'user': 'SYSTEM',
            'msg': f'{nickname} odaya katıldı.'
        }, room=code)
    else:
        emit('message', {
            'type': 'system',
            'user': 'SYSTEM',
            'msg': f'{nickname} yeniden bağlandı.'
        }, room=code)

    if room['started']:
        hands = room.get('hands', {})
        player_hand = hands.get(nickname)
        if player_hand:
            socketio.emit('initial_hand', {
                'room': code,
                'player': nickname,
                'tiles': player_hand,
                'is_turn': (nickname == room.get('current_turn')),
                'current_turn': room.get('current_turn'),
                'deck_remaining': len(room.get('deck', [])),

                'okey_tile': room.get('okey_tile'),
                'indicator': room.get('indicator'),
            }, to=request.sid)

            socketio.emit('state_sync', {
                'room': code,
                'current_turn': room.get('current_turn'),
                'last_discards': room.get('last_discards', {}),
                'indicator': room.get('indicator'),
                'okey_tile': room.get('okey_tile'),
            }, to=request.sid)

    emit_rooms_update()

@socketio.on('add_bot')
def add_bot(data):
    code = (data or {}).get('room', '').strip()

    code_from_sid, nick = find_by_sid(request.sid)
    if not code_from_sid or code_from_sid != code:
        emit('error', {'msg': 'Yetkisiz işlem!'})
        return

    room = rooms.get(code)
    if not room:
        emit('error', {'msg': 'Masa bulunamadı!'})
        return

    if room.get('started'):
        emit('error', {'msg': 'Oyun başladıktan sonra bot eklenemez.'})
        return

    host_nick = room.get('host', {}).get('nickname')
    if nick != host_nick:
        emit('error', {'msg': 'Sadece kurucu bot ekleyebilir.'})
        return

    if len(room.get('players', [])) >= MAX_PLAYERS:
        emit('error', {'msg': 'Masa dolu.'})
        return

    bot_no = 1
    while f"BOT_{bot_no}" in room["players"]:
        bot_no += 1

    bot_name = f"BOT_{bot_no}"
    room["players"].append(bot_name)

    socketio.emit('update_players', {'players': room['players']}, room=code)

    socketio.emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{bot_name} masaya eklendi.'
    }, room=code)

    emit_rooms_update()


@socketio.on('remove_bot')
def remove_bot(data):
    code = (data or {}).get('room', '').strip()
    bot_name = (data or {}).get('bot', '').strip()

    code_from_sid, nick = find_by_sid(request.sid)
    if not code_from_sid or code_from_sid != code:
        emit('error', {'msg': 'Yetkisiz işlem!'})
        return

    room = rooms.get(code)
    if not room:
        emit('error', {'msg': 'Masa bulunamadı!'})
        return

    if room.get('started'):
        emit('error', {'msg': 'Oyun başladıktan sonra bot kaldırılamaz.'})
        return

    host_nick = room.get('host', {}).get('nickname')
    if nick != host_nick:
        emit('error', {'msg': 'Sadece kurucu bot kaldırabilir.'})
        return

    if not bot_name.startswith("BOT_") or bot_name not in room["players"]:
        emit('error', {'msg': 'Bot bulunamadı.'})
        return

    room["players"].remove(bot_name)
    room.get("sids", {}).pop(bot_name, None)
    room.get("hands", {}).pop(bot_name, None)
    room.get("last_discards", {}).pop(bot_name, None)

    socketio.emit('update_players', {'players': room['players']}, room=code)

    socketio.emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{bot_name} masadan kaldırıldı.'
    }, room=code)

    emit_rooms_update()

# -------- Oyunu Başlat --------
@socketio.on('start_game')
def start_game(data):
    code = (data or {}).get('room', '').strip()

    if not code or code not in rooms:
        emit('error', {'msg': 'Masa bulunamadı!'})
        return

    code_from_sid, nick = find_by_sid(request.sid)
    if not code_from_sid or code_from_sid != code:
        emit('error', {'msg': 'Yetkisiz işlem!'})
        return

    room = rooms[code]

    if room.get('started'):
        emit('error', {'msg': 'Oyun zaten başladı!'})
        return

    host_nick = room.get('host', {}).get('nickname')
    if nick != host_nick:
        emit('error', {'msg': 'Sadece kurucu oyunu başlatabilir!'})
        return

    room['deck'] = create_deck()

    indicator = draw_indicator(room['deck'])
    room['indicator'] = indicator
    room['okey_tile'] = determine_okey_from_indicator(indicator)

    players = room.get('players', [])
    if not players:
        return

    starter = random.choice(players)

    deal_tiles(room, starter=starter)

    room['current_turn'] = starter
    room['starter'] = starter
    room['started'] = True

    start_turn_timer(socketio, code)

    remaining = len(room.get('deck', []))

    for p in room.get('players', []):
        sid = room.get('sids', {}).get(p)

        if not sid:
            continue

        socketio.emit('initial_hand', {
            'room': code,
            'player': p,
            'tiles': room['hands'].get(p, []),
            'is_turn': (p == room['current_turn']),
            'current_turn': room['current_turn'],
            'indicator': room.get('indicator'),
            'okey_tile': room.get('okey_tile'),
            'deck_remaining': remaining
        }, to=sid)

    socketio.emit('game_started', {
        'room': code,
        'current_turn': room['current_turn'],
        'indicator': room.get('indicator'),
        'okey_tile': room.get('okey_tile'),
        'deck_remaining': remaining
    }, room=code)

    socketio.emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': 'Oyun başladı!'
    }, room=code)

    emit_rooms_update()

    trigger_bot_if_needed(socketio, code)


# -------- Oyun Aksiyonları --------
@socketio.on('draw_tile')
def draw_tile(data):
    """Sırası gelen oyuncu desteden taş çeker."""
    requested_code = (data or {}).get('room', '').strip()

    code, nick = find_by_sid(request.sid)
    if not code or not nick:
        emit('error', {'msg': 'Kimlik bulunamadı, lütfen yeniden bağlan.'})
        return

    if requested_code and requested_code != code:
        emit('error', {'msg': 'Oyun odası uyuşmuyor.'})
        return

    room = rooms.get(code)
    if not room:
        emit('error', {'msg': 'Masa bulunamadı.'})
        return

    if nick not in room['players']:
        emit('error', {'msg': 'Bu masada kayıtlı değilsin.'})
        return

    if not room['started']:
        emit('error', {'msg': 'Oyun başlamadı.'})
        return

    if room.get('current_turn') != nick:
        emit('error', {'msg': 'Şu anda sıra sende değil.'})
        return

    hand = room['hands'].get(nick, [])
    real_count = sum(1 for t in hand if t != "0")
    if real_count >= 15:
        emit('error', {'msg': 'Bu turda daha fazla taş çekemezsin.'})
        return

    if not room['deck']:
        emit('error', {'msg': 'Çekilecek taş kalmadı.'})
        return

    tile = room['deck'].pop()

    placed = False
    for i, t in enumerate(hand):
        if t == "0":
            hand[i] = tile
            placed = True
            break
    if not placed:
        hand.append(tile)

    if not room['deck']:
        socketio.emit('game_finished', {
            'room': code,
            'winner': None,
            'reason': 'deck_empty'
        }, room=code)

        room['started'] = False
        room['current_turn'] = None
        return

    room['hands'][nick] = hand

    sid = room['sids'].get(nick)
    if sid:
        socketio.emit('tile_drawn', {
            'room': code,
            'player': nick,
            'tile': tile,
            'deck_remaining': len(room['deck']),
        }, to=sid)

    deck_remaining = len(room['deck'])
    socketio.emit('deck_count_update', {
        'room': code,
        'remaining': deck_remaining,
    }, room=code)

    emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{nick} bir taş çekti.'
    }, room=code)



@socketio.on('discard_tile')
def discard_tile(data):
    requested_code = (data or {}).get('room', '').strip()
    tile = (data or {}).get('tile')

    if not requested_code or not tile:
        return

    code, nick = find_by_sid(request.sid)
    if not code or not nick:
        emit('error', {'msg': 'Kimlik bulunamadı, lütfen yeniden bağlan.'})
        return

    if requested_code != code:
        emit('error', {'msg': 'Oyun odası uyuşmuyor.'})
        return

    room = rooms.get(code)
    if not room:
        return

    if room.get('current_turn') != nick:
        emit('error', {'msg': 'Sıra sende değil.'})
        return

    hand = room['hands'].get(nick, [])
    real_count = sum(1 for t in hand if t != "0")
    if real_count < 15:
        emit('error', {'msg': 'Önce taş çek.'})
        return

    removed = False
    for i, t in enumerate(hand):
        if t == tile:
            hand[i] = "0"
            removed = True
            break

    if not removed:
        return

    room['hands'][nick] = hand

    room.setdefault('discard_pile', [])
    room.setdefault('last_discards', {})
    room['discard_pile'].append(tile)
    room['last_discards'][nick] = tile

    players = room['players']
    idx = players.index(nick)
    nextp = players[(idx + 1) % len(players)]
    room['current_turn'] = nextp

    emit('discard_made', {
        'room': code,
        'player': nick,
        'tile': tile,
        'next_turn': nextp
    }, room=code)

    start_turn_timer(socketio, code)

    trigger_bot_if_needed(socketio, code)


@socketio.on('take_discard')
def take_discard(data):
    """Sırası gelen oyuncu, bir önceki oyuncunun attığı SON taşı yanından alır."""
    requested_code = (data or {}).get('room', '').strip()
    if not requested_code:
        return

    code, nick = find_by_sid(request.sid)
    if not code or not nick:
        emit('error', {'msg': 'Kimlik bulunamadı, lütfen yeniden bağlan.'})
        return

    if requested_code != code:
        emit('error', {'msg': 'Oyun odası uyuşmuyor.'})
        return

    room = rooms.get(code)
    if not room:
        return

    if nick not in room['players']:
        emit('error', {'msg': 'Bu masada kayıtlı değilsin.'})
        return

    if not room['started']:
        emit('error', {'msg': 'Oyun başlamadı.'})
        return

    if room.get('current_turn') != nick:
        emit('error', {'msg': 'Şu anda sıra sende değil.'})
        return

    players = room['players']
    if nick not in players:
        emit('error', {'msg': 'Oyuncu listesinde bulunamadın.'})
        return

    idx = players.index(nick)
    prev_player = players[(idx - 1) % len(players)]

    last_discards = room.get('last_discards', {})
    tile = last_discards.get(prev_player)

    if not tile:
        emit('error', {'msg': 'Alabileceğin bir taş yok.'})
        return

    hand = room['hands'].get(nick, [])

    real_count = sum(1 for t in hand if t != "0")
    if real_count >= 15:
        emit('error', {'msg': 'Bu turda daha fazla taş alamazsın.'})
        return

    placed = False
    for i, t in enumerate(hand):
        if t == "0":
            hand[i] = tile
            placed = True
            break
    if not placed:
        hand.append(tile)

    room['hands'][nick] = hand

    if room.get('discard_pile') and room['discard_pile'][-1] == tile:
        room['discard_pile'].pop()

    last_discards.pop(prev_player, None)
    room['last_discards'] = last_discards

    sid = room['sids'].get(nick)
    if sid:
        socketio.emit('tile_taken_from_discard', {
            'room': code,
            'player': nick,
            'tile': tile
        }, to=sid)

    emit('discard_taken', {
        'room': code,
        'from_player': prev_player
    }, room=code)

    emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{nick}, {prev_player} oyuncusunun attığı taşı aldı.'
    }, room=code)



@socketio.on('finish_hand')
def finish_hand(data):
    code = (data or {}).get('room', '').strip()
    nick = (data or {}).get('player', '').strip()

    if not code or not nick or code not in rooms:
        return

    room = rooms[code]

    if not room.get('started'):
        emit('error', {'msg': 'Oyun zaten bitmiş.'})
        return

    if room.get('current_turn') != nick:
        emit('error', {'msg': 'Sıra sende değil.'})
        return

    hand = room['hands'].get(nick, [])
    if not hand:
        emit('error', {'msg': 'Elin bulunamadı.'})
        return

    real_tiles = [t for t in hand if t != "0"]

    if not is_valid_win_hand(hand, room.get('okey_tile')):
        if len(real_tiles) > 14:
            emit('error', {
                'msg': '15 taş ile bitemezsin. Fazla taşı atıp tekrar dene.'
            })
            return

        emit('error', {
            'msg': 'Bu elde perler tam olmadığı için bitiremezsin.'
        })
        return

    try:
        save_match_result(room, code, nick, reason="win")
    except Exception as e:
        print("DB SAVE ERROR:", e)

    room['started'] = False
    room['current_turn'] = None
    room['winner'] = nick

    socketio.emit('game_finished', {
        'room': code,
        'winner': nick
    }, room=code)

    socketio.emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'Oyun bitti! Kazanan: {nick}'
    }, room=code)



@socketio.on('request_hand')
def request_hand(data):
    """Oyuncu tekrar bağlandığında ya da sayfayı yenilediğinde elini tekrar ister."""
    requested_code = (data or {}).get('room', '').strip()

    code, nick = find_by_sid(request.sid)
    if not code or not nick:
        return

    if requested_code and requested_code != code:
        return

    room = rooms.get(code)
    if not room:
        return

    hands = room.get('hands', {})
    if nick not in hands:
        return

    sid = room['sids'].get(nick, request.sid)
    is_turn = (nick == room.get('current_turn'))

    socketio.emit('initial_hand', {
        'room': code,
        'player': nick,
        'tiles': hands[nick],
        'is_turn': is_turn,
        'current_turn': room.get('current_turn'),
        'deck_remaining': len(room.get('deck', [])),

        'indicator': room.get('indicator'),
        'okey_tile': room.get('okey_tile'),

    }, to=sid)

    socketio.emit('state_sync', {
        'room': code,
        'current_turn': room.get('current_turn'),
        'last_discards': room.get('last_discards', {}),

        'indicator': room.get('indicator'),
        'okey_tile': room.get('okey_tile'),

    }, to=sid)


# -------- Sohbet --------
@socketio.on('send_message')
def send_message(data):
    msg = (data or {}).get('msg', '').strip()
    room_code = (data or {}).get('room', '').strip()
    if not msg or not room_code:
        return

    code, nick = find_by_sid(request.sid)

    if not code or code != room_code:
        return

    user = (nick or 'Anonim').strip() or 'Anonim'

    emit('message', {
        'type': 'chat',
        'user': user,
        'msg': msg
    }, room=room_code)


# -------- Masadan Ayrıl (BUTON) --------
@socketio.on('leave_room')
def leave(data):
    requested_code = (data or {}).get('room', '').strip()

    code, nickname = find_by_sid(request.sid)
    if not code or not nickname:
        return

    if requested_code and requested_code != code:
        return

    room = rooms.get(code)
    if not room:
        return

    players = room['players']

    if nickname not in players:
        return

    leaving_index = players.index(nickname)
    
    if room.get('started') and room.get('current_turn') == nickname:
        room["timer_token"] = room.get("timer_token", 0) + 1

        auto_discard_on_timeout(socketio, code)


    if 'hands' in room and nickname in room['hands']:
        del room['hands'][nickname]

    if 'last_discards' in room and nickname in room['last_discards']:
        del room['last_discards'][nickname]

    room['sids'].pop(nickname, None)

    players.remove(nickname)

    # Odada sadece botlar kaldıysa masayı kapat
    real_players = [p for p in players if not p.startswith("BOT_")]

    if not players or not real_players:
        del rooms[code]
        emit_rooms_update()
        return

    if nickname == room['host']['nickname']:
        new_host = players[0]
        room['host'] = {'nickname': new_host, 'sid': room['sids'].get(new_host)}
        socketio.emit('host_changed', {'room': code, 'host': new_host}, room=code)

        if len(players) <= 1:
            room['started'] = False
            room['current_turn'] = None

    emit_rooms_update()

    emit('player_left', {
        'room': code,
        'player': nickname,
        'players': players,
        'current_turn': room.get('current_turn')
    }, room=code)

    emit('message', {
        'type': 'system',
        'user': 'SYSTEM',
        'msg': f'{nickname} masadan ayrıldı.'
    }, room=code)


# -------- Disconnect --------
@socketio.on('disconnect')
def on_disconnect():
    """Tarayıcı kapanması gibi durumlarda temizlik."""
    code, nickname = find_by_sid(request.sid)
    if not code or code not in rooms or not nickname:
        return

    room = rooms[code]
    room['sids'].pop(nickname, None)

    real_connected_players = [
        p for p in room.get('players', [])
        if not p.startswith("BOT_") and p in room.get('sids', {})
    ]

    if not real_connected_players:
        del rooms[code]
        emit_rooms_update()
        return

    if room.get('started'):
        emit('message', {
            'type': 'system',
            'user': 'SYSTEM',
            'msg': f'{nickname} bağlantıyı kesti (yeniden bağlanabilir).'
        }, room=code)
        emit('update_players', {'players': room['players']}, room=code)
    else:
        emit('message', {
            'type': 'system',
            'user': 'SYSTEM',
            'msg': f'{nickname} bağlantıyı kesti (yeniden bağlanabilir).'
        }, room=code)
        emit('update_players', {'players': room['players']}, room=code)

    emit_rooms_update()



# -------- Aktif Masalar --------
@socketio.on('get_rooms')
def get_rooms():
    emit('rooms_list', {'rooms': serialize_rooms()})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)


def save_match_result(room_code, winner_nick, reason, mode, players):
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO match_results (room_code, winner_nick, reason, mode, players_json)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (room_code, winner_nick, reason, mode, json.dumps(players))
    )
    cur.close()
    conn.close()
    
