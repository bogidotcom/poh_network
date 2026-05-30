i tried scanning bitcoin address 1K6KoYC69NnafWJ7YgtrpwJxBLiijWqwa6, but i see it was trying to scan it as solana.

```
[BACKEND] [checker] Received scan request
[BACKEND] [txGraph] Solana error: Invalid public key input
[BACKEND] [checker] Scanning 60 methods for 1K6KoYC69NnafWJ7YgtrpwJxBLiijWqwa6
```

before calling methods it must validate what kind of address is given (if it's an address, because we also have other search keys like name, x account etc.)