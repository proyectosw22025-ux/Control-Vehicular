import logging
from rest_framework_simplejwt.authentication import JWTAuthentication  # type: ignore[import-untyped]
from rest_framework.exceptions import AuthenticationFailed  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)


class JWTAuthMiddleware:
    """
    Django middleware that authenticates requests using JWT tokens from
    the Authorization header, making request.user available in Strawberry
    resolvers via info.context.request.user.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if auth_header.startswith('Bearer '):
            auth = JWTAuthentication()
            try:
                result = auth.authenticate(request)
                if result is not None:
                    request.user, request.auth = result
            except (AuthenticationFailed, Exception):
                pass
        return self.get_response(request)
