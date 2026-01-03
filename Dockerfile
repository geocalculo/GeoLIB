# Imagen liviana de nginx
FROM nginx:1.25-alpine

# Copiamos el sitio completo al root público de nginx
COPY . /usr/share/nginx/html

# Config nginx (SPA fallback + cache)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Cloud Run usa $PORT (típicamente 8080)
EXPOSE 8080
CMD ["sh", "-c", "sed -i 's/listen 80;/listen '\"$PORT\"';/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
