---
id: queen-offers
uses:
  opera: ./opera.chess.md#opera
  reti: ./reti.chess.md#reti
collections:
  queen-offers: [opera, reti]
  encore:
    - queen-offers
    - as: opera-again
      use: opera
exports: [queen-offers, encore]
---
