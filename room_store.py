# room_store.py
import random
import string

rooms = {}

MAX_PLAYERS = 4

def _rand_code():
  return "OK" + ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))

def generate_room_code():
  """Kod çakışmasına karşı garanti."""
  code = _rand_code()
  while code in rooms:
    code = _rand_code()
  return code


def serialize_rooms():
  """Lobi için hafif özet."""
  out = []
  for code, room in rooms.items():
    host_val = room.get('host')

    if isinstance(host_val, dict):
      host_name = host_val.get('nickname')
    else:
      host_name = host_val

    out.append({
      'code': code,
      'host': host_name,
      'players': len(room.get('players', [])),
      'started': room.get('started', False),
      'mode': room.get('mode', 'Klasik'),
    })
  return out


def find_by_sid(sid):
  """
  Disconnect temizliği için:
  (room_code, nickname) döndürür, yoksa (None, None).
  """
  for code, room in rooms.items():
    for nick, nsid in room['sids'].items():
      if nsid == sid:
        return code, nick
  return None, None
