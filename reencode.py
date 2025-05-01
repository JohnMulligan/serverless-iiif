import base64
import re
import sys

filename=sys.argv[1]

d=open(filename)
imgstring=d.read()
d.close()

imgstring=re.search("/9j.*",imgstring)

if imgstring:
	imgdata = base64.b64decode(imgstring.group(0))
	with open(filename, 'wb') as f:
		f.write(imgdata)
	print(f"WROTE IMAGE DATA TO {filename}")
else:
	print("DID NOT FIND IMAGE DATA")
