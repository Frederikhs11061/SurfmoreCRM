import { POST } from './app/api/scrape-emails/route.js';

async function run() {
  const req = {
    json: async () => ({
      urls: ['https://webshoplisten.dk/baby-boern-og-teenager/']
    })
  };
  
  const res = await POST(req);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
