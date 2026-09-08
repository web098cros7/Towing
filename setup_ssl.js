const { SSMClient, SendCommandCommand } = require("@aws-sdk/client-ssm");

const ssm = new SSMClient({ region: "ap-south-1" });

async function run() {
  const commands = [
    "sudo dnf install -y nginx augeas-libs",
    "sudo python3 -m venv /opt/certbot/",
    "sudo /opt/certbot/bin/pip install --upgrade pip",
    "sudo /opt/certbot/bin/pip install certbot certbot-nginx",
    "sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot",
    
    "cat << 'EOF' > /etc/nginx/conf.d/api.conf",
    "server {",
    "    listen 80;",
    "    server_name api.mitow.in;",
    "",
    "    location / {",
    "        proxy_pass http://localhost:4000;",
    "        proxy_http_version 1.1;",
    "        proxy_set_header Upgrade $http_upgrade;",
    "        proxy_set_header Connection 'upgrade';",
    "        proxy_set_header Host $host;",
    "        proxy_cache_bypass $http_upgrade;",
    "    }",
    "}",
    "EOF",
    
    "sudo systemctl enable nginx",
    "sudo systemctl restart nginx",
    "sudo certbot --nginx -d api.mitow.in --non-interactive --agree-tos -m admin@mitow.in"
  ];

  const params = {
    DocumentName: "AWS-RunShellScript",
    InstanceIds: ["i-005d38ee6e74a4bcd"],
    Parameters: { commands }
  };

  try {
    const data = await ssm.send(new SendCommandCommand(params));
    console.log("Command sent. ID:", data.Command.CommandId);
  } catch (err) {
    console.error(err);
  }
}

run();
