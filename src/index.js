const IIIF = require("iiif-processor");
const debug = require("debug")("serverless-iiif:lambda");
const helpers = require("./helpers");
const auth = require("./verify-jwt");
const resolvers = require("./resolvers");
const { errorHandler } = require("./error");
const { streamifyResponse } = require("./streamify");

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const sharp = require("sharp");

const handleRequestFunc = streamifyResponse(async (event, context) => {
  debug("http path: ", event?.requestContext?.http?.path);
  const { addCorsHeaders, eventPath, fileMissing } = helpers;
  context.callbackWaitsForEmptyEventLoop = false;
  const shaKey = process.env.shaKey;
  const queryStringParameters = event.queryStringParameters;

  if (shaKey) {
   
    const req_auth = event.headers.authorization;
    if (!req_auth) {
      const resp = {
        statusCode: 401,
        statusDescription: "No Credentials Provided",
      };
      return resp;
    }
    const authorized = await auth.authorize(req_auth);
    if (authorized.statusCode != 200) {
      return authorized;
    }
  }

  let response;

  if (event.requestContext?.http?.method === "OPTIONS") {
    response = { statusCode: 204, body: null };
  } else if (event?.requestContext?.http?.path === "/") {
    response = handleServiceDiscoveryRequestFunc();
  } else if (/^\/iiif\/\d+\/?$/.test(event?.requestContext?.http?.path)) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      isBase64Encoded: false,
      body: "OK",
    };
  } else if (fileMissing(event)) {
    const location = eventPath(event) + "/info.json";
    response = {
      statusCode: 302,
      headers: { Location: location },
      body: "Redirecting to info.json",
    };
  } else if (!validateSize(event?.requestContext?.http?.path)) {    
      // Return a 403 Forbidden response
      response = {
        statusCode: 403,
        body: "Requested image size is not permitted",
      };
  } else {
      response = await handleResourceRequestFunc(event, context);
  }
  return addCorsHeaders(event, response);
});

function validateSize(path) {
  
  const pathParts = path.split('/');
  const size = pathParts[5];

  // 'max' and '^max' case 
  if (size.includes('max')) {
      return false; // Not permitted
  }
  
  // percentage 'pct:n' or '^pct:n' case
  if (size.includes('pct:')) {
      const percentage = parseFloat(size.split(':')[1]);
      return percentage <= 50; // Allow only up to 50% of image?
  }
  
  //'w,h' or '^w,h' or '!w,h', or '^!w,h' case 
  if (size.includes(',') && !size.startsWith(',') && !size.endsWith(',')) {
      const [width, height] = size.split(',').map(Number);
      const area = width * height;
      return area <= 262144; // 512*512
  }
  
  //'w,' or '^w,' case (width only)
  if (size.includes(',') && !size.startsWith(',') && size.endsWith(',')) {
      const width = parseInt(size.split(',')[0]);
      return width <= 512;
  }
  
  //',h' or '^,h' case (height only)
  if (size.includes(',') && size.startsWith(',')) {
      const height = parseInt(size.split(',')[1]);
      return height <= 512;
  }
  
  // Default: reject other formats
  return false;

}

const handleServiceDiscoveryRequestFunc = () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    isBase64Encoded: false,
    body: JSON.stringify({
      links: [
        { href: "/iiif/2/{:id}", name: "IIIF Image API v2 endpoint" },
        { href: "/iiif/3/{:id}", name: "IIIF Image API v3 endpoint" },
      ],
      versions: { ...require("sharp").versions },
    }),
  };
};

const executeResource = async (
  uri,
  streamResolver,
  dimensionFunction,
  density,
  sharpOptions = {}
) => {
  try {
    const debugBorder = process.env.debugBorder === "true";
    const pageThreshold = parseInt(process.env.pageThreshold) || undefined;
    const resource = new IIIF.Processor(uri, streamResolver, {
      dimensionFunction,
      density,
      debugBorder,
      pageThreshold,
      sharpOptions,
    });
    return await resource.execute();
  } catch (err) {
    if (
      /Invalid tile part index/.test(err.message) &&
      !sharpOptions.jp2Oneshot
    ) {
      console.log(
        "Encountered JP2 tile part index error. Trying oneshot load."
      );
      return await executeResource(
        uri,
        streamResolver,
        dimensionFunction,
        density,
        { ...sharpOptions, jp2Oneshot: true }
      );
    }
    throw err;
  }
};

const handleResourceRequestFunc = async (event, context) => {
  const density = helpers.parseDensity(process.env.density);
  const { getUri } = helpers;
  const preflight = process.env.preflight === "true";
  const { streamResolver, dimensionResolver } = resolvers.resolverFactory(
    event,
    preflight
  );
  let resource;
  try {
    const uri = getUri(event);

    const result = await executeResource(
      uri,
      streamResolver,
      dimensionResolver,
      density
    );
    return makeResponse(result, event);
  } catch (err) {
    return errorHandler(err, event, context, resource);
  }
};

const s3 = new S3Client({ region: "us-east-1" });

const applyWatermark = async (imageBuffer) => {
  try {
    // Fetch the image from S3
    const command = new GetObjectCommand({
      Bucket: process.env.tiffBucket,
      Key: "road_logo_white.svg",
    });

    const streamToBuffer = async (stream) => {
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    };

    const { Body } = await s3.send(command);

    const bodyBuffer =
      Body instanceof Buffer ? Body : await streamToBuffer(Body);

    const baseMetadata = await sharp(imageBuffer).metadata();
    const logoBuffer = await sharp(bodyBuffer)
      .resize({
        width: Math.min(200, baseMetadata.width),
        height: Math.min(200, baseMetadata.height),
        fit: "cover",
      })
      .toBuffer();

    return await sharp(imageBuffer)
      .composite([
        {
          input: logoBuffer,
          gravity: "center",
          blend: "over",
          opacity: 0.5,
        },
      ])
      .toBuffer();
  } catch (err) {
    console.error("Error applying watermark:", err);
    throw err;
  }
};

const makeResponse = async (result, event) => {
  const linkHeaders = ["canonical", "profile"]
    .map((rel) => ({ rel, property: `${rel}Link` }))
    .filter(({ property }) => result[property])
    .map(({ rel, property }) => `<${result[property]}>; rel=${rel}`);

  let res_body = result.body;

  let image_data = res_body;
  image_data = await applyWatermark(image_data);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": result.contentType,
      Link: linkHeaders.length > 0 ? linkHeaders.join(",") : undefined,
    },
    isBase64Encoded: true,
    body: Buffer.from(image_data).toString("base64"),
  };
};

module.exports = {
  handler: handleRequestFunc,
};
