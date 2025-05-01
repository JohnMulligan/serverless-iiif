// Modified from AWS example
const crypto = require ('crypto');

const shaKey = process.env.shaKey;

//Response when JWT is not valid.
const response403 = {
    statusCode: 403,
    statusDescription: 'Forbidden'
};

const response401 = {
    statusCode: 401,
    statusDescription: 'Unauthorized'
};

const response200 = {
    statusCode: 200,
    statusDescription: 'Hooray'
};

function jwt_decode(token, key, noVerify, algorithm) {
    // check token
    if (!token) {
        throw new Error('No token supplied');
    }
    // check segments
    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('Not enough or too many segments');
    }

    // All segment should be base64
    const headerSeg = segments[0];
    const payloadSeg = segments[1];
    const signatureSeg = segments[2];

    // base64 decode and parse JSON
    const payload = JSON.parse(_base64urlDecode(payloadSeg));
    if (!token) {
        payload['k']='No token supplied'
        throw new Error('No token supplied');
    }
    
        if (segments.length !== 3) {
        payload['k']='Not enough or too many segments'
        throw new Error('Not enough or too many segments');
    }

    if (!noVerify) {
        const signingMethod = 'sha256';
        const signingType = 'hmac';

        // Verify signature. `sign` will return base64 string.
        const signingInput = [headerSeg, payloadSeg].join('.');

        if (!_verify(signingInput, key, signingMethod, signingType, signatureSeg)) {
            payload['k']='signature verification failed'
            throw new Error('Signature verification failed')
            
        }

        // Support for nbf and exp claims.
        // According to the RFC, they should be in seconds.
        if (payload.nbf && Date.now() < payload.nbf*1000) {
            console.log('Token not yet active')
            payload['k']='token not yet active'
            throw new Error('Token not yet active')
        }

        if (payload.exp && Date.now() > payload.exp*1000) {
            console.log('token expired')
            payload['k']='token expired'
            throw new Error('Token expired')
        }
    }

    return payload;
}

//Function to ensure a constant time comparison to prevent
//timing side channels.
function _constantTimeEquals(a, b) {
    if (a.length != b.length) {
        return false;
    }

    let xor = 0;
    for (let i = 0; i < a.length; i++) {
    xor |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    }

    return 0 === xor;
}

function _verify(input, key, method, type, signature) {
    if(type === "hmac") {
        return _constantTimeEquals(signature, _sign(input, key, method));
    }
    else {
        throw new Error('Algorithm type not recognized');
    }
}

function _sign(input, key, method) {
    return crypto.createHmac(method, key).update(input).digest('base64url');
}

function _base64urlDecode(str) {
    return Buffer.from(str, 'base64url')
}

const authorize = async (querystring) => {
  console.log("QUERYSTRING",querystring)
  if(!shaKey) {
      response401['statusDescription']="No Secret Key"
      return response401;
  }
  
//   console.log("------>",querystring)
  
//   const response200 = {
//     statusCode: 200,
//     statusDescription: 'Hooray'
//   };
  const devEnv = process.env.devEnv;
  let JWT;
  if (devEnv=="true") {
    JWT=querystring.jwt.value;
  } else {
    JWT=querystring.jwt;
  };
  
  console.log("JWT",JWT)

//   try{ 
      jwt_decode(JWT, shaKey);
//   }
//   catch(e) {
//       response401['statusDescription']="DID NOT DECODE JWT"
//       return response401;
//   }
  console.log("200",response200)
  return response200;
}

module.exports = {
  authorize: authorize
}

