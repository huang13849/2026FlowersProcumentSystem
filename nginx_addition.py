with open('nginx-gateway/nginx.conf') as f:
    content = f.read()

# Add /api/prices proxy
old = '''        location /api/ai {
            proxy_pass http://host.docker.internal:3003;
            proxy_http_version 1.1;
            proxy_set_header Host ;
            client_max_body_size 30m;
            proxy_read_timeout 180s;
        }'''
new = '''        location /api/prices {
            proxy_pass http://host.docker.internal:3009;
            proxy_http_version 1.1;
            proxy_set_header Host ;
        }

        location /api/ai {
            proxy_pass http://host.docker.internal:3003;
            proxy_http_version 1.1;
            proxy_set_header Host ;
            client_max_body_size 30m;
            proxy_read_timeout 180s;
        }'''
content = content.replace(old, new)

# Add /price location
old_p = '''        location /ai {
            alias /usr/share/nginx/html;
            try_files /ai.html =404;
        }'''
new_p = '''        location /price {
            alias /usr/share/nginx/html;
            try_files /price.html =404;
        }

        location /ai {
            alias /usr/share/nginx/html;
            try_files /ai.html =404;
        }'''
content = content.replace(old_p, new_p)

with open('nginx-gateway/nginx.conf', 'w') as f:
    f.write(content)
print('OK')
