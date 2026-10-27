// Saifuro's published sample verdict and their production key set, copied
// from the live pages on 27 Oct 2026 (not hand-typed). Saifuro's guide says to
// keep a copy of the key set; the live test below checks this copy is current.
//   https://docs.saifuro.com/reference/verify-a-verdict
//   https://verdicts.saifuro.com/.well-known/jwks.json

export const SAIFURO_JWKS_URL = "https://verdicts.saifuro.com/.well-known/jwks.json";
export const SAIFURO_ISSUER = "https://verdicts.saifuro.com";

// Signed 2026-09-03 08:43 UTC with kid verdict-2026-09; predates request.currency.
export const SAIFURO_SAMPLE_VERDICT =
  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InZlcmRpY3QtMjAyNi0wOSJ9.eyJpc3MiOiJodHRwczovL3ZlcmRpY3RzLnNhaWZ1cm8uY29tIiwianRpIjoiZGVjXzViMmUiLCJpYXQiOjE3ODg0MjQ5ODAsImV4cCI6MTc4ODQyNTI4MCwidmVyZGljdCI6ImFsbG93IiwibWFuZGF0ZSI6Im1uZF83ZjNhIiwicG9saWN5X3ZlcnNpb24iOiJwb2xfMjAyNi0wOC0xMi4zIiwibm9uY2UiOiJuXzlkMDJjNmU0IiwicmVxdWVzdCI6eyJhZ2VudCI6ImFndF9wcm9jdXJlbWVudF8wMSIsImFtb3VudCI6MzQwLCJyZWNpcGllbnQiOiJ2ZW5kb3I6YWNtZV9zYWFzIiwiY2F0ZWdvcnkiOiJzYWFzIn19.oV4a02jtE2oEKvnSXxQ-YqJcpp8UvFZiuh3AeTb5Iy5Ony9jC1AA7EX-YPSKDuSFPxSNS4SlXLtU9-j0J36cbQ";

export const SAIFURO_JWKS = {
  keys: [
    {
      kty: "EC",
      crv: "P-256",
      x: "0sSLihPTUCksZoUJR3Eh22UcZhhOu8-nEqSa_98rE_I",
      y: "eXSPgBZzeT1E6HtkD8tlg8yujO37jKQhH3SDd99Xx68",
      use: "sig",
      alg: "ES256",
      kid: "verdict-2026-09",
    },
    {
      kty: "EC",
      crv: "P-256",
      x: "a-rplIyo_roXB-US6oyMQtkMVa2Gtnwew2p76Gx3EWI",
      y: "pB7cmlFee8NlencjiBD7hQhq0hO2YyAqBnbUr-b9frY",
      use: "sig",
      alg: "ES256",
      kid: "sandbox-2026-09",
    },
  ],
};
