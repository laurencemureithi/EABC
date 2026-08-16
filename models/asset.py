import sqlite3

class Asset:
    def __init__(self, id, name, category, location, value):
        self.id = id
        self.name = name
        self.category = category
        self.location = location
        self.value = value

    @staticmethod
    def get_by_id(asset_id):
        conn = sqlite3.connect("database/eabc.db")
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute("SELECT * FROM assets WHERE id = ?", (asset_id,))
        row = cur.fetchone()
        conn.close()

        if row:
            return Asset(
                row["id"],
                row["name"],
                row["category"],
                row["location"],
                row["value"]
            )
        return None
