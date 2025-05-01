const IIIF = require('iiif-processor');
const debug = require('debug')('serverless-iiif:lambda');
const helpers = require('./helpers');
const auth = require('./verify-jwt');
const resolvers = require('./resolvers');
const { errorHandler } = require('./error');
const { streamifyResponse } = require('./streamify');

const handleRequestFunc = streamifyResponse(async (event, context) => {
  debug('http path: ', event?.requestContext?.http?.path);
  const { addCorsHeaders, eventPath, fileMissing } = helpers;

  context.callbackWaitsForEmptyEventLoop = false;
  
//   check to see if we are authenticating with a url query jwt, and if so, run it
  const shaKey = process.env.shaKey;
//   return {statusCode:401,body:event}
  
  const devEnv = process.env.devEnv;
//   console.log(event)
  let querystring;
  if (devEnv=="true") {
    console.log("DEVENV")
//     console.log(event.requestContext)
//     console.log(event.requestContext.http)
    querystring = event.requestContext.http.querystring
  } else {
    console.log("NOTDEVENV")
    console.log(event)
    querystring=event.queryStringParameters
//     console.log(event.rawQueryString)
  };
  
//   return {"statusCode":200,"body":querystring}
  console.log("querystring",querystring)
  
  
  if(shaKey) {  
    console.log("USING SHA KEY")
    if (!querystring) {
      const resp={
        "statusCode":401,
        "statusDescription": 'No JWT'
      }
      return resp
    }
    const authorized=await auth.authorize(querystring);
    if (authorized.statusCode!=200){
      const resp={
        "statusCode":403,
        "statusDescription": 'Unauthorized'
      }
      return resp
    }
  }


  let response;
  if (event.requestContext?.http?.method === 'OPTIONS') {
    // OPTIONS REQUEST
    response = { statusCode: 204, body: null };
  } else if (event?.requestContext?.http?.path === '/') {
    response = handleServiceDiscoveryRequestFunc();
  } else if (/^\/iiif\/\d+\/?$/.test(event?.requestContext?.http?.path)) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain'
      },
      isBase64Encoded: false,
      body: 'OK'
    };
  } else if (fileMissing(event)) {
    // INFO.JSON REQUEST
    const location = eventPath(event) + '/info.json';
    response = { statusCode: 302, headers: { Location: location }, body: 'Redirecting to info.json' };
  } else {
    // IMAGE REQUEST
    response = await handleResourceRequestFunc(event, context);
  }
  return addCorsHeaders(event, response);
});

const handleServiceDiscoveryRequestFunc = () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    isBase64Encoded: false,
    body: JSON.stringify({
      links: [
        {
          href: '/iiif/2/{:id}',
          name: 'IIIF Image API v2 endpoint'
        },
        {
          href: '/iiif/3/{:id}',
          name: 'IIIF Image API v3 endpoint'
        }
      ],
      versions: { ...require('sharp').versions }
    })
  };
};

const executeResource = async (uri, streamResolver, dimensionFunction, density, sharpOptions = {}) => {
  try {
    const debugBorder = process.env.debugBorder === 'true';
    const pageThreshold = parseInt(process.env.pageThreshold) || undefined;
    const resource = new IIIF.Processor(uri, streamResolver, { dimensionFunction, density, debugBorder, pageThreshold, sharpOptions });
    return await resource.execute();
  } catch (err) {
    if (/Invalid tile part index/.test(err.message) && !sharpOptions.jp2Oneshot) {
      console.log('Encountered JP2 tile part index error. Trying oneshot load.');
      return await executeResource(uri, streamResolver, dimensionFunction, density, { ...sharpOptions, jp2Oneshot: true });
    }
    throw err;
  }
};

const handleResourceRequestFunc = async (event, context) => {
  const density = helpers.parseDensity(process.env.density);
  const { getUri } = helpers;
  const preflight = process.env.preflight === 'true';
  const { streamResolver, dimensionResolver } = resolvers.resolverFactory(event, preflight);

  let resource;
  try {
    const uri = getUri(event);
    const result = await executeResource(uri, streamResolver, dimensionResolver, density);
    return makeResponse(result);
  } catch (err) {
    return errorHandler(err, event, context, resource);
  }
};

const makeResponse = (result) => {
  const linkHeaders = ['canonical', 'profile']
    .map((rel) => {
      return { rel, property: `${rel}Link` };
    })
    .filter(({ property }) => result[property])
    .map(({ rel, property }) => `<${result[property]}>; rel=${rel}`);
  
  const res_body=result.body;
  
  const devEnv = process.env.devEnv;
  
  let image_data;
  
  if (devEnv=="true") {
    console.log("RUNNING IN DEVELOPMENT MODE")
    image_data=Buffer.from(res_body).toString('base64') 
  } else {
    image_data=res_body
  };
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': result.contentType,
      Link: linkHeaders.length > 0 ? linkHeaders.join(',') : undefined
    },
    isBase64Encoded: false,
    body: image_data
  }
};

module.exports = {
  handler: handleRequestFunc
};
