import json
import qrcode
from PIL import Image, ImageDraw, ImageFont
import os

# 1. Configurações e Pastas
ARQUIVO_JSON = 'data/alunos.json'
PASTA_SAIDA = 'crachas_impressao'

if not os.path.exists(PASTA_SAIDA):
    os.makedirs(PASTA_SAIDA)

def gerar_crachas():
    try:
        with open(ARQUIVO_JSON, 'r', encoding='utf-8') as f:
            alunos = json.load(f)
    except FileNotFoundError:
        print("Erro: Arquivo alunos.json não encontrado!")
        return

    for aluno in alunos:
        nome = aluno['nome']
        turma = aluno['turma']
        tag = aluno['tag']
       
        print(f"Gerando crachá para: {nome}...")

        # 2. Criar o QR Code
        qr = qrcode.QRCode(version=1, box_size=10, border=4)
        qr.add_data(tag)
        qr.make(fit=True)
        img_qr = qr.make_image(fill_color="black", back_color="white").convert('RGB')

        # 3. Criar o fundo do Crachá (mais largo que o QR para caber o texto)
        largura_qr, altura_qr = img_qr.size
        altura_total = altura_qr + 100
        cracha = Image.new('RGB', (largura_qr, altura_total), color='white')
       
        # Colar o QR Code no topo
        cracha.paste(img_qr, (0, 0))

        # 4. Escrever o Nome e Turma (Texto centralizado)
        draw = ImageDraw.Draw(cracha)
       
        # Tenta carregar uma fonte, se não tiver, usa a padrão
        try:
            fonte_nome = ImageFont.truetype("arial.ttf", 25)
            fonte_turma = ImageFont.truetype("arial.ttf", 18)
        except:
            fonte_nome = ImageFont.load_default()
            fonte_turma = ImageFont.load_default()

        # Desenhar o Nome
        draw.text((largura_qr/2, altura_qr + 10), nome, fill="black", font=fonte_nome, anchor="mm")
        # Desenhar a Turma
        draw.text((largura_qr/2, altura_qr + 45), turma, fill="gray", font=fonte_turma, anchor="mm")

        # 5. Salvar o arquivo
        nome_arquivo = f"{aluno['id']:02d}_{nome.replace(' ', '_')}.png"
        cracha.save(os.path.join(PASTA_SAIDA, nome_arquivo))

    print(f"\n✅ Sucesso! {len(alunos)} crachás gerados na pasta '{PASTA_SAIDA}'.")

if __name__ == "__main__":
    gerar_crachas()
