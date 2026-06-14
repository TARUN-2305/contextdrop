from django.urls import path
from .views import ingest_document, search_capsule, verify_capsule, log_analytic, get_analytics
from .views import register_user, login_user, logout_user, list_user_capsules, update_capsule_tags

urlpatterns = [
    path('ingest', ingest_document, name='ingest_document'),
    path('capsules/<str:slug>/search', search_capsule, name='search_capsule'),
    path('capsules/<str:slug>/verify', verify_capsule, name='verify_capsule'),
    path('capsules/<str:slug>/analytics', log_analytic, name='log_analytic'),
    path('capsules/<str:slug>/dashboard', get_analytics, name='get_analytics'),
    
    # Auth & Global Dashboard
    path('auth/register', register_user, name='register_user'),
    path('auth/login', login_user, name='login_user'),
    path('auth/logout', logout_user, name='logout_user'),
    path('user/capsules', list_user_capsules, name='list_user_capsules'),
    path('capsules/<str:slug>/tags', update_capsule_tags, name='update_capsule_tags'),
]
