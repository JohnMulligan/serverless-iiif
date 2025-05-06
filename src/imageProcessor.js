import { S3 } from "aws-sdk";

const s3 = new S3();

/**
 * Fetches an image from an S3 bucket.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {string} key - The key (path) of the image in the bucket.
 * @returns {Buffer} - The image as a buffer.
 */
const fetchImageFromS3 = async (bucketName, key) => {
  try {
    const s3Object = await s3.getObject({ Bucket: bucketName, Key: key }).promise();
    return s3Object.Body; // Return the image buffer
  } catch (error) {
    console.error("Error fetching image from S3:", error);
    throw error;
  }
};

export default { fetchImageFromS3 };