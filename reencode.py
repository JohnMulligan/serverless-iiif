import base64
import re
import sys

filename=sys.argv[1]

d=open(filename)
imgstring=d.read()
d.close()

imgstring=re.search("/9j.*",imgstring).group(0)
imgdata = base64.b64decode(imgstring)
 
with open(filename, 'wb') as f:
    f.write(imgdata)
