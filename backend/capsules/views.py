import secrets
import json
import hashlib
from datetime import timedelta
from django.utils import timezone
from django.db import connection
from django.shortcuts import get_object_or_404
from django.contrib.auth.hashers import make_password, check_password
from django.conf import settings
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from pypdf import PdfReader

from .models import Capsule, DocumentChunk, CapsuleAnalytic
from .utils import chunk_text_by_pages, get_embedding, classify_domain, scrape_url_text, generate_suggested_questions

def is_internal_request(request):
    auth_header = request.headers.get('Authorization') or request.META.get('HTTP_AUTHORIZATION')
    if auth_header and auth_header.startswith('Bearer '):
        token = auth_header.split('Bearer ')[1].strip()
        return token == settings.INTERNAL_API_KEY
    return False


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser])
def ingest_document(request):
    uploaded_file = request.FILES.get('file')
    url_input = request.data.get('url', '').strip()

    if not uploaded_file and not url_input:
        return Response({'error': 'No file uploaded and no URL provided'}, status=status.HTTP_400_BAD_REQUEST)

    ttl_days = request.data.get('ttl_days', 7)  # default to 7 days
    
    # Generate unique slug
    slug = secrets.token_urlsafe(6)[:8]
    while Capsule.objects.filter(slug=slug).exists():
        slug = secrets.token_urlsafe(6)[:8]

    # Calculate expiration
    expires_at = timezone.now() + timedelta(days=int(ttl_days))

    # Parse document page-by-page or scrape URL
    pages_dict = {}
    file_name = "Web Link"

    try:
        if url_input:
            scraped_text = scrape_url_text(url_input)
            pages_dict[1] = scraped_text
            file_name = url_input.split('//')[-1].split('/')[0] # extract domain name
        else:
            file_name = uploaded_file.name
            file_type = uploaded_file.name.split('.')[-1].lower()
            if file_type == 'pdf':
                reader = PdfReader(uploaded_file)
                for i, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    pages_dict[i + 1] = text
            elif file_type == 'txt':
                text = uploaded_file.read().decode('utf-8', errors='ignore')
                pages_dict[1] = text
            else:
                return Response({'error': f'Unsupported file type: {file_type}'}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({'error': f'Failed to parse file or scrape URL: {str(e)}'}, status=status.HTTP_400_BAD_REQUEST)

    # Perform chunking
    chunks = chunk_text_by_pages(pages_dict)
    if not chunks:
        return Response({'error': 'No text could be extracted from the document'}, status=status.HTTP_400_BAD_REQUEST)

    # Temporary domain classification using the first chunk
    first_chunk_text = chunks[0]['text']
    detected_domain = classify_domain(first_chunk_text)

    # Save Capsule
    password = request.data.get('password', '').strip()
    password_hash = make_password(password) if password else ''
    logo_url = request.data.get('logo_url', '').strip()
    accent_color = request.data.get('accent_color', '').strip()
    title = request.data.get('title', '').strip() or file_name

    # Generate suggested starter questions based on the first chunk
    suggested_list = generate_suggested_questions(first_chunk_text)
    suggested_json = json.dumps(suggested_list)

    capsule = Capsule.objects.create(
        slug=slug,
        title=title,
        expires_at=expires_at,
        domain=detected_domain,
        password_hash=password_hash,
        suggested_questions=suggested_json,
        custom_logo_url=logo_url,
        custom_accent_color=accent_color
    )

    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Token '):
        token_key = auth_header.split('Token ')[1]
        try:
            token = Token.objects.get(key=token_key)
            capsule.creator = token.user
            capsule.save()
        except Token.DoesNotExist:
            pass

    # Save document chunks with embeddings using raw SQL to cast vector types explicitly
    try:
        with connection.cursor() as cursor:
            for chunk in chunks:
                text_chunk = chunk['text']
                # Generate embedding
                embedding_vector = get_embedding(text_chunk)
                # Format list of floats as a pgvector string representation: [x,y,z...]
                vector_str = "[" + ",".join(map(str, embedding_vector)) + "]"
                
                cursor.execute(
                    "INSERT INTO capsules_documentchunk (capsule_id, text, page_number, section_title, chunk_index, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s::vector)",
                    [str(capsule.id), text_chunk, chunk['page_number'], '', chunk['chunk_index'], vector_str]
                )
    except Exception as e:
        capsule.delete()
        return Response({'error': f'Failed to process and embed chunks: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({
        'id': str(capsule.id),
        'slug': capsule.slug,
        'domain': capsule.domain,
        'expires_at': capsule.expires_at.isoformat(),
        'file_name': file_name,
        'message': f'Ingestion successful. Processed {len(chunks)} chunks.'
    }, status=status.HTTP_201_CREATED)

@api_view(['POST'])
@parser_classes([JSONParser])
def search_capsule(request, slug):
    if not is_internal_request(request):
        return Response({'error': 'Unauthorized: Internal service authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

    capsule = get_object_or_404(Capsule, slug=slug)

    # Expiry Check
    if capsule.expires_at and timezone.now() > capsule.expires_at:
        return Response({'error': 'Capsule link has expired'}, status=status.HTTP_410_GONE)

    # Password Check
    if capsule.password_hash:
        provided_password = request.data.get('password') or request.headers.get('X-Capsule-Password') or request.query_params.get('password')
        if not provided_password or not check_password(provided_password, capsule.password_hash):
            return Response({'error': 'Access denied: correct password is required.'}, status=status.HTTP_401_UNAUTHORIZED)

    question = request.data.get('question', '').strip()
    if not question:
        return Response({'error': 'Question is required'}, status=status.HTTP_400_BAD_REQUEST)

    # Generate question embedding
    try:
        query_embedding = get_embedding(question)
        vector_str = "[" + ",".join(map(str, query_embedding)) + "]"
    except Exception as e:
        return Response({'error': f'Failed to embed question: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Perform pgvector cosine distance search
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT text, page_number, section_title, chunk_index, "
                "(embedding <=> %s::vector) AS distance "
                "FROM capsules_documentchunk WHERE capsule_id = %s "
                "ORDER BY distance ASC LIMIT 5",
                [vector_str, str(capsule.id)]
            )
            rows = cursor.fetchall()
    except Exception as e:
        return Response({'error': f'Similarity search query failed: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Map search results
    search_results = []
    for row in rows:
        # Avoid sharing very low similarity matches if needed, but for general top-k we return all sorted
        search_results.append({
            'text': row[0],
            'page_number': row[1],
            'section_title': row[2],
            'chunk_index': row[3],
            'distance': float(row[4]) if row[4] is not None else 0.0
        })

    return Response({
        'slug': capsule.slug,
        'domain': capsule.domain,
        'chunks': search_results
    }, status=status.HTTP_200_OK)

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def verify_capsule(request, slug):
    capsule = get_object_or_404(Capsule, slug=slug)

    # Expiry check
    is_expired = False
    if capsule.expires_at and timezone.now() > capsule.expires_at:
        is_expired = True

    password_required = bool(capsule.password_hash)

    # Get provided password from json payload, query param, or headers
    provided_password = None
    if request.method == 'POST':
        provided_password = request.data.get('password')
    if not provided_password:
        provided_password = request.query_params.get('password') or request.headers.get('X-Capsule-Password')

    verified = False
    if password_required:
        if provided_password:
            verified = check_password(provided_password, capsule.password_hash)
    else:
        verified = True

    # Parse suggested questions list
    suggested = []
    if capsule.suggested_questions:
        try:
            suggested = json.loads(capsule.suggested_questions)
        except Exception:
            pass

    return Response({
        'slug': capsule.slug,
        'domain': capsule.domain,
        'expires_at': capsule.expires_at.isoformat() if capsule.expires_at else None,
        'is_expired': is_expired,
        'password_required': password_required,
        'verified': verified,
        'suggested_questions': suggested,
        'custom_logo_url': capsule.custom_logo_url,
        'custom_accent_color': capsule.custom_accent_color
    }, status=status.HTTP_200_OK)

@api_view(['POST'])
@parser_classes([JSONParser])
def log_analytic(request, slug):
    if not is_internal_request(request):
        return Response({'error': 'Unauthorized: Internal service authentication required.'}, status=status.HTTP_401_UNAUTHORIZED)

    capsule = get_object_or_404(Capsule, slug=slug)
    
    question = request.data.get('question', '').strip()
    was_answered = request.data.get('was_answered', True)
    page_number = request.data.get('page_number')

    if not question:
        return Response({'error': 'Question is required for analytics logging'}, status=status.HTTP_400_BAD_REQUEST)

    # Compute SHA-256 hash
    q_hash = hashlib.sha256(question.lower().encode('utf-8')).hexdigest()

    # Log raw question only if not answered to protect reader privacy
    unanswered_text = question if not was_answered else ""

    CapsuleAnalytic.objects.create(
        capsule=capsule,
        question_hash=q_hash,
        unanswered_text=unanswered_text,
        was_answered=was_answered,
        page_number=page_number
    )

    return Response({'status': 'Analytic logged'}, status=status.HTTP_201_CREATED)

@api_view(['GET', 'POST'])
@parser_classes([JSONParser])
def get_analytics(request, slug):
    capsule = get_object_or_404(Capsule, slug=slug)

    # Ownership check via Capsule ID (UUID) or Auth Token
    provided_id = request.headers.get('X-Capsule-ID') or request.data.get('capsule_id') or request.query_params.get('capsule_id')
    is_owner = False
    
    if provided_id and str(provided_id) == str(capsule.id):
        is_owner = True
        
    auth_header = request.headers.get('Authorization')
    if auth_header and auth_header.startswith('Token '):
        token_key = auth_header.split('Token ')[1]
        try:
            from rest_framework.authtoken.models import Token
            token = Token.objects.get(key=token_key)
            if capsule.creator == token.user:
                is_owner = True
        except Exception:
            pass

    if not is_owner:
        return Response({'error': 'Access denied: Creator authentication token (Capsule ID) is missing or invalid.'}, status=status.HTTP_403_FORBIDDEN)

    # Gather metrics
    total = capsule.analytics.count()
    answered = capsule.analytics.filter(was_answered=True).count()
    unanswered = capsule.analytics.filter(was_answered=False).count()
    
    unanswered_list = list(capsule.analytics.filter(was_answered=False).exclude(unanswered_text="").values_list('unanswered_text', flat=True))

    # Heatmap aggregation
    from django.db.models import Count
    page_queries = capsule.analytics.filter(was_answered=True, page_number__isnull=False)\
                                    .values('page_number')\
                                    .annotate(count=Count('id'))\
                                    .order_by('page_number')
    
    heatmap = {item['page_number']: item['count'] for item in page_queries}

    return Response({
        'slug': capsule.slug,
        'total_queries': total,
        'answered_queries': answered,
        'unanswered_queries_count': unanswered,
        'unanswered_list': unanswered_list,
        'heatmap': heatmap
    }, status=status.HTTP_200_OK)

# ==========================================
# AUTHENTICATION AND GLOBAL DASHBOARD APIs
# ==========================================

@api_view(['POST'])
def register_user(request):
    username = request.data.get('username')
    password = request.data.get('password')
    email = request.data.get('email', '')
    if not username or not password:
        return Response({'error': 'Username and password required'}, status=status.HTTP_400_BAD_REQUEST)
    if User.objects.filter(username=username).exists():
        return Response({'error': 'Username already exists'}, status=status.HTTP_400_BAD_REQUEST)
    
    user = User.objects.create_user(username=username, email=email, password=password)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'username': user.username}, status=status.HTTP_201_CREATED)

@api_view(['POST'])
def login_user(request):
    username = request.data.get('username')
    password = request.data.get('password')
    user = authenticate(username=username, password=password)
    if not user:
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'username': user.username}, status=status.HTTP_200_OK)

@api_view(['POST'])
def logout_user(request):
    if request.user.is_authenticated:
        request.user.auth_token.delete()
    return Response({'message': 'Logged out successfully'}, status=status.HTTP_200_OK)

@api_view(['GET'])
def list_user_capsules(request):
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Token '):
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    
    token_key = auth_header.split('Token ')[1]
    try:
        token = Token.objects.get(key=token_key)
        user = token.user
    except Token.DoesNotExist:
        return Response({'error': 'Invalid token'}, status=status.HTTP_401_UNAUTHORIZED)
        
    capsules = Capsule.objects.filter(creator=user).order_by('-created_at')
    
    data = []
    for cap in capsules:
        queries = cap.analytics.count()
        unanswered = cap.analytics.filter(was_answered=False).count()
        tags = [t.name for t in cap.tags.all()]
        data.append({
            'slug': cap.slug,
            'title': cap.title,
            'domain': cap.domain,
            'created_at': cap.created_at,
            'expires_at': cap.expires_at,
            'queries': queries,
            'unanswered': unanswered,
            'tags': tags,
        })
    return Response({'capsules': data}, status=status.HTTP_200_OK)

@api_view(['POST', 'DELETE'])
def update_capsule_tags(request, slug):
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Token '):
        return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
    token_key = auth_header.split('Token ')[1]
    try:
        user = Token.objects.get(key=token_key).user
        capsule = Capsule.objects.get(slug=slug, creator=user)
    except (Token.DoesNotExist, Capsule.DoesNotExist):
        return Response({'error': 'Not found or unauthorized'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'POST':
        new_tag_name = request.data.get('tag', '').strip()
        if new_tag_name:
            from .models import Tag
            tag, _ = Tag.objects.get_or_create(name=new_tag_name, user=user)
            capsule.tags.add(tag)
            return Response({'status': 'tag added'})
        return Response({'error': 'no tag provided'}, status=400)
        
    elif request.method == 'DELETE':
        tag_to_remove = request.data.get('tag', '').strip()
        if tag_to_remove:
            from .models import Tag
            try:
                tag = Tag.objects.get(name=tag_to_remove, user=user)
                capsule.tags.remove(tag)
                return Response({'status': 'tag removed'})
            except Tag.DoesNotExist:
                return Response({'error': 'tag not found'}, status=404)
        return Response({'error': 'no tag provided'}, status=400)
