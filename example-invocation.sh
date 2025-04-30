sam local invoke -e event.json -n env.json --region us-east-1 --no-memory-limit > res.jpg
python3 reencode.py res.jpg
