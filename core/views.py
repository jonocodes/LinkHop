from django.http import HttpRequest, HttpResponse


def healthcheck(_request: HttpRequest) -> HttpResponse:
    return HttpResponse("ok", content_type="text/plain")
