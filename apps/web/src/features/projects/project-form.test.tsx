import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api';
import { ProjectForm } from './project-form';

describe('ProjectForm', () => {
  it('valida no cliente e não envia formulário inválido', async () => {
    const onSubmit = vi.fn();
    render(<ProjectForm submitLabel="Cadastrar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Código'), 'a b');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByText('Use letras, números, ponto, hífen ou sublinhado')).toBeInTheDocument();
    expect(screen.getByText('Campo obrigatório')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('normaliza o código e envia valores válidos', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectForm submitLabel="Cadastrar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Código'), 'res-01');
    await userEvent.type(screen.getByLabelText('Nome'), 'Residencial');
    await userEvent.selectOptions(screen.getByLabelText('Classificação'), 'LOTEAMENTO');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RES-01', name: 'Residencial', classification: 'LOTEAMENTO' }),
    );
  });

  it('exibe erro geral e erros de campo devolvidos pela API', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError({
        type: 'x',
        title: 'Conflito',
        status: 409,
        code: 'PROJECT_CODE_IN_USE',
        detail: 'Já existe um empreendimento com o código RES-01.',
        errors: [{ path: 'code', message: 'Código já utilizado' }],
      }),
    );
    render(<ProjectForm submitLabel="Cadastrar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Código'), 'RES-01');
    await userEvent.type(screen.getByLabelText('Nome'), 'Residencial');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));
    expect(await screen.findByText('Já existe um empreendimento com o código RES-01.')).toBeInTheDocument();
    expect(screen.getByText('Código já utilizado')).toBeInTheDocument();
  });

  it('mostra a descrição da classificação selecionada', async () => {
    render(<ProjectForm submitLabel="Cadastrar" onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Classificação'), 'MISTO');
    expect(screen.getByText(/Combina torres, casas, loteamento/)).toBeInTheDocument();
  });
});
