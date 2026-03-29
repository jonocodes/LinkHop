# LinkHop Bookmarklet Spec

## Goal

Provide a lightweight bookmarklet for sending the current page URL into LinkHop without requiring an extension.

## Phase 1

The bookmarklet should:

1. Read the current browser URL.
2. Open LinkHop at `/hop`.
3. Pass the current page URL as `type=url&body=...`.
4. Let the existing send flow handle recipient selection and confirmation.

Bookmarklet shape:

```javascript
javascript:(function(){
  var u="https://linkhop.example.com/hop";
  var q='?type=url&body='+encodeURIComponent(window.location.href);
  var target=u+q;
  var popup=window.open(target,'linkhop','popup,width=540,height=720,resizable=yes,scrollbars=yes');
  if(!popup){window.location.href=target;}
})();
```

## Why this approach

- Reuses the existing `/hop` and `/send` flow.
- Uses the browser's existing LinkHop cookie session.
- Avoids API credentials in bookmarklet code.
- Avoids CORS and custom-header issues.

## Admin support

For now, LinkHop should provide an admin page with:

- a drag-to-bookmarks link
- a short explanation of what it does
- the concrete `/hop` base URL for the current server

## Future phases

- Include page title in the send flow.
- Support default recipient selection.
- Preserve pending share through `/connect` if the browser is not already paired.
- Support selected text as an optional note.
