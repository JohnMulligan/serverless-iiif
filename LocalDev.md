# SAM local invocations

In order to customize this application or contribute to the code base, it is necessary to be able to develop locally.

This requires recreating the containerized environment, either by using AWS's SAM CLI or by writing a custom docker build (SAM uses docker to containerize).

The advantages of the SAM CLI are that you get a lot of features out of the box, and that it has, baked in, AWS's unevenly-documented deployment quirks. The disadvantage is the same -- it doesn't (appear to) behave entirely in the same way as a production deployment does.

To work with this environment locally, you will need to first install the SAM CLI. In order to do that, you will need an AWS account, and read-only permissions to certain Lambda actions. You will also need a working docker installation locally.

Once you have installed the SAM CLI and docker engine, you will need to configure an env file. Copy ```env.json-example``` to ```env.json``` and set the ```tiffBucket``` parameter to your bucket name.

You can now run through the following iterative workflow:

* Change the local code
* Build the container with the command: ```npm run build```
* Invoke the container with the ```example-invocation.sh``` script
	* This pulls on
		* env.json, in which you should have specified your bucket name
		* event.json, which defines the GET call to your function. importantly:
			* headers
			* iiif uri
	* The memory limit doesn't appear to be affected by the shell script argument
	* The tile size limit doesn't appear to be affected by this file
* That script finally invokes a python script, which turns the output raw text response into the image you've requested (in ```event.json```).

You will find the image you requested at ```res.jpg```.

--------

Note:

Re-encoding of the output appears to be necessary, as this issue seems to still be live: https://github.com/aws/aws-sam-cli/issues/6369

Therefore -- until I figure out how to do this with an environment variable -- you should switch on the dev version of the response body, currently available on line 110 of ```src/index.js```. Please always turn it off before you deploy.
