#!/bin/bash

cd ..
docker system prune -a -f
docker-compose up smm -d --build
docker-compose logs smm -f --tail 200