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
  } else {
    response = await handleResourceRequestFunc(event, context);
  }
  return addCorsHeaders(event, response);
});

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
  
  const devEnv = process.env.devEnv;
  if (devEnv == "true") {
    console.log("RUNNING IN DEVELOPMENT MODE");
    image_data = Buffer.from(image_data).toString("base64");
  }
  
  const corsAllowOrigin = process.env.corsAllowOrigin;
  
  const final_resp={
    statusCode: 200,
    headers: {
      "Content-Type": result.contentType,
      Link: linkHeaders.length > 0 ? linkHeaders.join(",") : undefined,
      "Access-Control-Allow-Origin":corsAllowOrigin
    },
    isBase64Encoded: true,
    body: image_data
  };
  
//   console.log(final_resp)

  return final_resp;
};

module.exports = {
  handler: handleRequestFunc,
};
