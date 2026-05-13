# db.py
import json
import mysql.connector

def get_db():
    return mysql.connector.connect(
        host="127.0.0.1",
        port=3306,
        user="root",
        password="",
        database="hadiokey",
        autocommit=True,
        use_pure=True
    )

def save_match_result(room, room_code, winner_nick=None, reason="win"):
    players = room.get("players", [])
    mode = room.get("mode")

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO match_results
        (room_code, winner_nick, reason, mode, players_json)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (room_code, winner_nick, reason, mode, json.dumps(players, ensure_ascii=False))
    )
    cur.close()
    conn.close()