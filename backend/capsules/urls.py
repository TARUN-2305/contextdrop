from django.urls import path
from .views import ingest_document, search_capsule, verify_capsule, log_analytic, get_analytics

urlpatterns = [
    path('ingest', ingest_document, name='ingest_document'),
    path('capsules/<str:slug>/search', search_capsule, name='search_capsule'),
    path('capsules/<str:slug>/verify', verify_capsule, name='verify_capsule'),
    path('capsules/<str:slug>/analytics', log_analytic, name='log_analytic'),
    path('capsules/<str:slug>/dashboard', get_analytics, name='get_analytics'),
]
