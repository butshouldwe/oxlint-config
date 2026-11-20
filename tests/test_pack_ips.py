"""Seeded literal-preservation properties, including Lyra F1's colon labels."""

import ipaddress
import os
import random
import sys
import unittest

from pack_ips import addresses

SEED = int(os.environ.get("PACK_IP_PROP_SEED", random.SystemRandom().randrange(2**32)))
CASES = int(os.environ.get("PACK_IP_PROP_CASES", "120"))
print(f"PACK_IP_PROP_SEED={SEED} PACK_IP_PROP_CASES={CASES}", file=sys.stderr)


# Lyra's round-5 differential contract, filtered to private IPv4.
IPV4_CASES = [
    ("10.20.30.40:8080: note", "10.20.30.40"),
    ("10.020.30.40 x", "10.20.30.40"),
    ("192.168.001.1:80", "192.168.1.1"),
    ("1.2.3.4.10.0.0.1", "10.0.0.1"),
    ("v1.10.20.30.40", "10.20.30.40"),
    ("10.0.0.1.", "10.0.0.1"),
    ("x.10.0.0.1", "10.0.0.1"),
    ("(10.0.0.1)", "10.0.0.1"),
    ("http://10.0.0.1/x", "10.0.0.1"),
    ("10.0.0.1:", "10.0.0.1"),
    ("ip=10.0.0.1,", "10.0.0.1"),
    ("8.8.8.8", None),
    ("v1.2.3.4", None),
    ("1.2.3.4.5", None),
]


class LiteralProperties(unittest.TestCase):
    def test_ipv4_differential_contract(self):
        for text, expected in IPV4_CASES:
            with self.subTest(text=text):
                found = {address for address in addresses(text)
                         if address.version == 4 and address.is_private}
                self.assertEqual(found, {ipaddress.IPv4Address(expected)} if expected else set())

    def test_ipv4_broad_match_and_decimal_octets(self):
        rng = random.Random(SEED)
        # The five ruling inputs, then generated siblings with the same shapes.
        cases = [
            ("10.20.30.40:8080: note", "10.20.30.40"),
            ("10.0.0.1.", "10.0.0.1"),
            ("10.020.30.40 x", "10.20.30.40"),
            ("192.168.001.1:80", "192.168.1.1"),
            ("x.10.0.0.1", "10.0.0.1"),
        ]
        for _ in range(CASES):
            a, b, c = (rng.randrange(256) for _ in range(3))
            literal = f"10.{a}.{b}.{c}"
            cases += [
                (literal + f":{rng.randrange(1, 65536)}: note", literal),
                (literal + ".", literal),
                (f"10.{a:03}.{b}.{c} x", literal),
                (f"192.168.{b:03}.{c}:80", f"192.168.{b}.{c}"),
                ("x." + literal, literal),
                ("v1." + literal, literal),
                ("1.2.3.4." + literal, literal),
            ]
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertIn(ipaddress.IPv4Address(expected), list(addresses(text)))
        for value in (256, 999, rng.randrange(256, 1000)):
            for position in range(4):
                octets = [10, 20, 30, 40]
                octets[position] = value
                text = ".".join(map(str, octets))
                with self.subTest(invalid=text):
                    self.assertEqual(list(addresses(text)), [])
        for _ in range(CASES):
            # A digit prefix must not turn an overlong first octet into a match.
            text = f"1{rng.randrange(100, 256)}.20.30.40"
            with self.subTest(overlong=text):
                self.assertEqual(list(addresses(text)), [])

    def test_literal_survives_prose_decoration(self):
        rng = random.Random(SEED)
        self.assertGreaterEqual(CASES, 16)
        counts = {"private": 0, "public": 0}
        for i in range(CASES):
            suffix = rng.randrange(1, 65535)
            literal, private = [
                (f"10.{rng.randrange(256)}.{rng.randrange(256)}.{rng.randrange(256)}", True),
                (f"100.{rng.randrange(64, 128)}.0.1", True),
                ("127.0.0.1", True),
                (f"fd12:3456::{suffix:x}", True),
                ("::1", True),
                (f"::ffff:10.20.{rng.randrange(256)}.1", True),
                (f"8.8.{rng.randrange(256)}.1", False),
                ("100.63.255.255", False),
                ("100.128.0.0", False),
                (f"2606:4700::{suffix:x}", False),
                ("::ffff:8.8.8.8", False),
                ("192.168.1.5", True),
                ("fd12:3456::", True),
                ("2606:4700::", False),
                (f"fe80::{suffix:x}", True),
                ("::", True),
            ][i % 16]
            reference = ipaddress.ip_address(literal)
            if isinstance(reference, ipaddress.IPv6Address) and reference.ipv4_mapped:
                reference = reference.ipv4_mapped
            internal = reference.is_private or reference.is_loopback or (
                reference.version == 4 and 0x64400000 <= int(reference) <= 0x647fffff
            )
            self.assertEqual(internal, private, "generator label disagrees with reference")
            counts["private" if private else "public"] += 1
            forms = [literal, literal + ".", f"[{literal}]", f"\"{literal}\"",
                     *(label + ":" + literal for label in ("host", "IP", "Address", "IPv6")),
                     "IP :" + literal, "IP: " + literal]
            if "." in literal and ":" not in literal:
                forms += [literal + ":3112", "host:" + literal + ":3112",
                          "http://" + literal + ":3112/api"]
            else:
                forms += ["http://[" + literal + "]:3112/api"]
            if ":" in literal:
                # Interface names and prose punctuation vary independently.
                variants = [literal, *(literal + "%" + zone for zone in
                                      ("wlan0", "lo", "eth0", "enp0s3", "4", "iface_1.2-3"))]
                forms += [prefix + value + suffix
                          for value in variants
                          for prefix in ("", "Address:", "host:")
                          for suffix in ("", ": note", ".", "]:3112/api")]
            for form in forms:
                with self.subTest(form=form):
                    self.assertEqual(list(addresses("note " + form + " end")), [reference])
        self.assertGreater(counts["private"], CASES // 3)
        self.assertGreater(counts["public"], CASES // 4)


if __name__ == "__main__":
    unittest.main()
