"""Tiny in-memory stand-in for the supabase-py query builder used in FS-17..FS-20 tests.

Supports: table(...).select(...).eq/in_/neq/order/limit(...).execute(), insert, update, upsert,
and rpc(name, params) through a dict of python callables.
"""
import copy
import uuid


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self._order = None
        self._limit = None

    # builders -------------------------------------------------------------
    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, rows, **_k):
        self.op, self.payload = "insert", rows
        return self

    def upsert(self, rows, **_k):
        self.op, self.payload = "upsert", rows
        return self

    def update(self, values):
        self.op, self.payload = "update", values
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def neq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) != str(val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals)
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, a, b):
        return self

    # execution ------------------------------------------------------------
    def _rows(self):
        return [r for r in self.db.tables.setdefault(self.table, []) if all(f(r) for f in self.filters)]

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "select":
            out = self._rows()
            if self._order:
                out = sorted(out, key=lambda r: str(r.get(self._order[0]) or ""), reverse=self._order[1])
            if self._limit:
                out = out[: self._limit]
            return _Result(copy.deepcopy(out))
        if self.op in ("insert", "upsert"):
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for item in items:
                item = dict(item)
                item.setdefault("id", str(uuid.uuid4()))
                unique = self.db.unique.get(self.table)
                if unique and any(r.get(unique) == item.get(unique) for r in rows if item.get(unique)):
                    if self.op == "upsert":
                        continue
                    raise Exception(f"duplicate key value violates unique constraint ({unique})")
                rows.append(item)
                out.append(copy.deepcopy(item))
            return _Result(out)
        if self.op == "update":
            hit = self._rows()
            for r in hit:
                r.update(self.payload)
            return _Result(copy.deepcopy(hit))
        raise NotImplementedError(self.op)


class _Rpc:
    def __init__(self, fn, params):
        self.fn, self.params = fn, params

    def execute(self):
        return _Result(self.fn(self.params))


class FakeDB:
    def __init__(self, rpcs=None, unique=None, **tables):
        self.tables = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.rpcs = rpcs or {}
        self.unique = unique or {}
        self.rpc_calls = []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return _Rpc(self.rpcs[name], params)
