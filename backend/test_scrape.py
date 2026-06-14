import requests

url = "https://black-mirror.fandom.com/api.php?action=parse&page=Nosedive&format=json"
headers = {
    'User-Agent': 'Mozilla/5.0'
}

print("Fetching URL...")
try:
    res = requests.get(url, headers=headers, timeout=15)
    print("Status code:", res.status_code)
    import json
    data = res.json()
    html_content = data['parse']['text']['*']
    
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html_content, 'html.parser')
    text = soup.get_text(separator='\n')
    print("Extracted characters:", len(text))
    print("Preview:\n", text[:500])
except Exception as e:
    print(f"Error: {e}")
