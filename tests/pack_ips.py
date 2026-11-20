"""Find literal IPs in prose for accidental-disclosure membership checks."""

import ipaddress
import re


V4 = re.compile(r"(?<![0-9])(?=(\d{1,3}(?:\.\d{1,3}){3})(?![0-9]))")


# Parses: UTF-8 package prose, not encoded or deliberately ambiguous evasion.
# IPv4 is independent of colon punctuation: match overlapping decimal quads
# unless immediately preceded by a digit. Accept leading zeros as decimal,
# reject octets outside 0-255, then canonicalize before ipaddress classification.
# Broad matches can include version-like text; no version exception narrows it.
# IPv6 retains the whole-address tokenizer below. Deduplicate mapped IPv4
# results shared by the two passes; output order is IPv4, then IPv6.
def addresses(text):
    seen = set()
    for match in V4.finditer(text):
        literal = match.group(1)
        octets = [int(part) for part in literal.split(".")]
        if any(part > 255 for part in octets):
            continue
        address = ipaddress.IPv4Address(".".join(map(str, octets)))
        if address not in seen:
            seen.add(address)
            yield address
    for address in ipv6_addresses(text):
        if address not in seen:
            seen.add(address)
            yield address


# Parses: UTF-8 package prose, looking for literal IPs (not encoded evasion).
# Preserve whole IPv6 literals, including valid final :: and mapped addresses.
# Recognize colon labels, brackets, quotes, sentence periods, IPv4 URL ports,
# interface zones and one prose colon after an otherwise valid address.
# Zone names do not affect membership; validate the address before % unchanged.
# Do not start inside an alphanumeric label (such as the 6 in IPv6). A wholly
# hexadecimal label is ambiguous with a hextet; a valid whole address wins.
# Non-IP text is ignored. This is not a general prose or URL parser.
def ipv6_addresses(text):
    for token in re.findall(r"(?<![0-9A-Za-z])[0-9a-fA-F:.]+(?:%[0-9A-Za-z_.-]+)?", text):
        token = token.split("%", 1)[0].strip(".")
        # Remove a separator, never the valid leading :: of a bare address.
        if token.startswith(":") and (not token.startswith("::") or token.startswith(":::")):
            token = token[1:]
        if token.count(":") == 1 and "." in token:
            token = token.split(":", 1)[0]
        try:
            address = ipaddress.ip_address(token)
        except ValueError:
            # Parse the whole candidate first: rstrip would corrupt valid ::.
            try:
                address = ipaddress.ip_address(token.removesuffix(":"))
            except ValueError:
                continue
        if isinstance(address, ipaddress.IPv6Address):
            yield address.ipv4_mapped or address
