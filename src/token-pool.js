// let API_BASE_URL = 'http://localhost:5000';
let API_BASE_URL = 'https://ghosterysearch.com';

const PUBLIC_EXP = 65537;

function bnToBase64(bn) {
  return sjcl.codec.base64.fromBits(bn.toBits());
}

function base64ToBn(b64) {
  return sjcl.bn.fromBits(sjcl.codec.base64.toBits(b64));
}

class TokenPool {
  constructor() {
    this.acquiredTokens = [];
  }

  async getModulus() {
    if (!this._cachedModulus) {
      const response = await fetch(`${API_BASE_URL}/info`);
      const { modulus } = await response.json();
      this._cachedModulus = base64ToBn(modulus);
    }
    return this._cachedModulus
  }

  makePretoken(mod) {
    const token = sjcl.bn.random(mod, /* paranoia */);
    const blindFactor = sjcl.bn.random(mod, /* paranoia */);
    const blindToken = blindFactor.powermod(PUBLIC_EXP, mod).mulmod(token, mod);
    return { token, blindFactor, blindToken };
  }

  async generateTokens() {
    const mod = await this.getModulus();
    const blindTokens = [];
    const pretokens = [];

    for (let i = 0; i < 10; i += 1) {
      const { token, blindFactor, blindToken } = this.makePretoken(mod);
      blindTokens.push(bnToBase64(blindToken));
      pretokens.push({ token, blindFactor });
    }

    const response = await fetch(`${API_BASE_URL}/tokens/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AccessToken.get()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blindTokens,
      }),
    });
    if (response.ok) {
      const { tokens } = await response.json();
      const res = [];
      tokens.forEach((_blindToken, i) => {
        const blindToken = base64ToBn(_blindToken);
        const { token, blindFactor } = pretokens[i];
        const sig = blindToken.mulmod(blindFactor.inverseMod(mod), mod);
        const goodSig = sig.powermod(PUBLIC_EXP, mod).equals(token);
        if (!goodSig) {
          console.error('Hey, got some invalid tokens, bad bank!!!');
        } else {
          // Now I have a token and a valid RSA signature on it by the server
          res.push({
            token: bnToBase64(token),
            sig: bnToBase64(sig),
          });
        }
      });
      console.warn(`Adding ${res.length} tokens to acquired pool`);
      this.acquiredTokens.push(...res);
    } else {
      console.error("Wrong access token");
    }
  }
}