---
name: smm-directus-query
description: Query Directus data from inside the SMM container. Use $COLLECTION, $FILTER, $FIELDS placeholders. Saves writing the full docker exec + axios boilerplate.
---

# Query Directus from SMM container

Runs a read-only query against the Directus API from inside the `smm` container. Uses `DIRECTUS_STATIC_TOKEN` from the container environment.

## Template

```
docker exec smm node --input-type=module -e "
import axios from 'axios';
const url = 'http://directus:8055';
const token = process.env.DIRECTUS_STATIC_TOKEN;
try {
  const resp = await axios.get(url + '/items/$COLLECTION', {
    headers: { Authorization: 'Bearer ' + token },
    params: { $FILTER, fields: '$FIELDS', limit: $LIMIT }
  });
  console.log(JSON.stringify(resp.data.data, null, 2));
} catch(e) {
  console.error(e.response?.data || e.message);
}
"
```

## Common examples

**List items in a collection:**
```
docker exec smm node --input-type=module -e "
import axios from 'axios';
const url = 'http://directus:8055';
const token = process.env.DIRECTUS_STATIC_TOKEN;
const resp = await axios.get(url + '/items/user_campaigns', {
  headers: { Authorization: 'Bearer ' + token },
  params: { fields: 'id,social_media_settings,content_style', limit: 5 }
});
console.log(JSON.stringify(resp.data.data, null, 2));
"
```

**Filter by campaign ID:**
```
docker exec smm node --input-type=module -e "
import axios from 'axios';
const url = 'http://directus:8055';
const token = process.env.DIRECTUS_STATIC_TOKEN;
const campaignId = '$CAMPAIGN_ID';
const resp = await axios.get(url + '/items/user_campaigns/' + campaignId, {
  headers: { Authorization: 'Bearer ' + token },
  params: { fields: 'id,social_media_settings,content_style' }
});
console.log(JSON.stringify(resp.data, null, 2));
"
```

**Query global_api_keys:**
```
docker exec smm node --input-type=module -e "
import axios from 'axios';
const url = 'http://directus:8055';
const token = process.env.DIRECTUS_STATIC_TOKEN;
const resp = await axios.get(url + '/items/global_api_keys', {
  headers: { Authorization: 'Bearer ' + token },
  params: { fields: 'service_name,api_key', limit: 20 }
});
console.log(JSON.stringify(resp.data.data, null, 2));
"
```

## Notes

- Directus internal URL: `http://directus:8055` (from within the container network).
- Admin token is `process.env.DIRECTUS_STATIC_TOKEN` (already set in container).
- For user-level operations, use the user's JWT token, NOT the admin token.
- Always limit results to avoid large console output.