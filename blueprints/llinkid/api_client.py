import json
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "https://cached-api.katholiekonderwijs.vlaanderen"

TYPE_CURRICULUM = "LLINKID_CURRICULUM"
TYPE_GOAL = "LLINKID_GOAL"
TYPE_GOAL_SECTION = "LLINKID_GOAL_SECTION"
TYPE_GOAL_LIST = "LLINKID_GOAL_LIST"
TYPE_SECTION = "SECTION"


def _http_get(url: str, max_retries: int = 3) -> dict:
    headers = {
        "User-Agent": "bk-dk-lpd-web/1.0 (Python)",
        "Accept": "application/json",
    }
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 503 and attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
        except (urllib.error.URLError, OSError):
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise


def _extract_body(item: dict) -> dict:
    if "$$expanded" in item:
        return item["$$expanded"]
    if "body" in item:
        return item["body"]
    return item


def _get_title(node: dict) -> str:
    for field in ("title", "description", "label", "name"):
        val = node.get(field)
        if val and isinstance(val, str):
            return val.strip()
    return ""


def _get_identifiers(node: dict) -> str:
    ids = node.get("identifiers") or []
    if isinstance(ids, list):
        return ", ".join(str(i) for i in ids)
    return str(ids)


def _get_parent_key(node: dict) -> str | None:
    for rel in node.get("$$relationsFrom", []):
        exp = rel.get("$$expanded", rel)
        if exp.get("relationtype") == "IS_PART_OF":
            href = exp.get("to", {}).get("href", "")
            if href:
                return href.rstrip("/").split("/")[-1]
    return None


class LLinkidClient:
    def __init__(self, base_url: str = BASE_URL):
        self._base_url = base_url.rstrip("/")
        self._cache: dict[str, object] = {}

    def _get(self, path: str, params: dict = None) -> dict:
        if params:
            url = f"{self._base_url}{path}?{urllib.parse.urlencode(params)}"
        else:
            url = f"{self._base_url}{path}"

        if url in self._cache:
            return self._cache[url]

        data = _http_get(url)
        self._cache[url] = data
        return data

    def _get_all(self, path: str, params: dict = None) -> list[dict]:
        params = params or {}
        url = f"{self._base_url}{path}?{urllib.parse.urlencode(params)}" if params else f"{self._base_url}{path}"

        cache_key = f"all:{url}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        results = []
        current_url = url
        while current_url:
            data = _http_get(current_url)
            results.extend(data.get("results", []))
            next_url = data.get("$$meta", {}).get("next")
            if next_url and not next_url.startswith("http"):
                current_url = self._base_url + next_url
            else:
                current_url = next_url

        self._cache[cache_key] = results
        return results

    def _haal_boom(self, uuid: str) -> list[dict]:
        cache_key = f"boom:{uuid}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        items = self._get_all("/content/", {"root": uuid, "limit": 5000})
        nodes = [_extract_body(item) for item in items]
        self._cache[cache_key] = nodes
        return nodes

    def get_leerplannen(self, zoekterm: str = None) -> list[dict]:
        items = self._get_all("/content/", {
            "type": TYPE_CURRICULUM,
            "limit": 5000,
            "expand": "summary",
        })

        resultaten = []
        for item in items:
            body = _extract_body(item)
            titel = _get_title(body)
            identifier = _get_identifiers(body)
            key = body.get("key", item.get("href", "").rstrip("/").split("/")[-1])

            if zoekterm:
                term = zoekterm.lower()
                if term not in titel.lower() and term not in identifier.lower():
                    continue

            resultaten.append({
                "uuid": key,
                "titel": titel,
                "identifier": identifier,
            })

        return resultaten

    def get_leerplan_detail(self, uuid: str) -> dict:
        data = self._get(f"/content/{uuid}")
        body = _extract_body(data)

        identifiers = body.get("identifiers", [])
        identifier = ", ".join(str(i) for i in identifiers) if identifiers else ""

        versie = body.get("version", body.get("$$version", ""))
        datum = str(body.get("issued", body.get("publicationDate", "")))[:10]

        return {
            "uuid": uuid,
            "titel": _get_title(body),
            "identifier": identifier,
            "versie": versie,
            "datum": datum,
        }

    def get_doelen(self, uuid: str) -> list[dict]:
        nodes = self._haal_boom(uuid)

        index = {}
        for node in nodes:
            key = node.get("key")
            if key:
                n = dict(node)
                n["_children"] = []
                index[key] = n

        root_keys = []
        for key, node in index.items():
            parent_key = _get_parent_key(node)
            if parent_key and parent_key in index:
                index[parent_key]["_children"].append(key)
            else:
                root_keys.append(key)

        display_types = {TYPE_GOAL, TYPE_GOAL_SECTION, TYPE_SECTION, TYPE_GOAL_LIST}

        def _flatten(keys, depth=0):
            result = []
            for k in keys:
                node = index.get(k)
                if not node:
                    continue
                ntype = node.get("type", "")
                if ntype in display_types:
                    identifiers = node.get("identifiers", [])
                    nr = ", ".join(str(i) for i in identifiers) if identifiers else ""
                    goal_type = node.get("llinkidGoalType", "")

                    result.append({
                        "key": k,
                        "type": ntype,
                        "titel": _get_title(node),
                        "nr": nr,
                        "depth": depth,
                        "goal_type": goal_type,
                        "is_goal": ntype == TYPE_GOAL,
                        "is_section": ntype in (TYPE_GOAL_SECTION, TYPE_SECTION, TYPE_GOAL_LIST),
                    })
                result.extend(_flatten(node["_children"], depth + 1))
            return result

        return _flatten(root_keys)

    def zoek_leerplannen(self, query: str) -> list[dict]:
        return self.get_leerplannen(zoekterm=query)
