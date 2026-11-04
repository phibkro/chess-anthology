---
id: remix
uses:
  nets: ./collection.chess.md#queen-offers
  selected: ./collection.chess.md#queen-offers/reti
collections:
  reversed:
    - as: first
      use: selected
    - as: second
      use: nets/opera
exports: [remix, reversed]
---

# A composed story
@id remix

@include nets/opera as opening

@include selected as comparison

@include nets/opera as reprise
