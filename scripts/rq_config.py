import os

current = os.path.dirname(os.path.realpath(__file__))
parent = os.path.dirname(current)

DB_DIR = os.path.join(parent, "db")